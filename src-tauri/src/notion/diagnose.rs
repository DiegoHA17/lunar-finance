//! Diagnóstico de la conexión paso a paso. Cada paso distingue un tipo de fallo (token, permisos, identificador,
//! esquema, lectura) y dice qué hacer. Ningún paso escribe en Notion.

use super::client::NotionClient;
use super::service::{PAGE_SIZE, list_sources, retrieve_schema};
use super::types::SchemaDto;
use crate::config::{AppConfig, Role, SourceConfig, field_specs, normalize_notion_id};
use crate::error::AppError;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticStep {
    pub id: String,
    pub title: String,
    pub status: StepStatus,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub steps: Vec<DiagnosticStep>,
    /// `true` si los movimientos se pueden leer con el mapeo actual.
    pub movements_ready: bool,
    pub categories_ready: bool,
    pub integration_name: Option<String>,
    pub workspace_name: Option<String>,
}

fn step(id: &str, title: &str, status: StepStatus, detail: impl Into<String>) -> DiagnosticStep {
    DiagnosticStep { id: id.into(), title: title.into(), status, detail: detail.into(), hint: None, error: None }
}

fn failed(id: &str, title: &str, err: AppError) -> DiagnosticStep {
    DiagnosticStep {
        id: id.into(),
        title: title.into(),
        status: StepStatus::Error,
        detail: err.message.clone(),
        hint: err.hint.clone(),
        error: Some(err),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingIssue {
    pub field: String,
    pub severity: StepStatus,
    pub message: String,
}

/// Compara el mapeo configurado con el esquema real.
pub fn check_mapping(role: Role, src: &SourceConfig, schema: &SchemaDto) -> Vec<MappingIssue> {
    let mut issues = Vec::new();
    for spec in field_specs(role) {
        match src.fields.get(spec.key) {
            None if spec.required => issues.push(MappingIssue {
                field: spec.key.into(),
                severity: StepStatus::Error,
                message: format!("El campo «{}» no tiene ninguna propiedad asignada.", spec.label),
            }),
            None => {}
            Some(fref) => match schema.properties.iter().find(|p| p.id == fref.id) {
                None => issues.push(MappingIssue {
                    field: spec.key.into(),
                    severity: if spec.required { StepStatus::Error } else { StepStatus::Warning },
                    message: format!("La propiedad «{}» (campo «{}») ya no existe en Notion.", fref.name, spec.label),
                }),
                Some(p) if !spec.types.contains(&p.kind.as_str()) => issues.push(MappingIssue {
                    field: spec.key.into(),
                    severity: StepStatus::Error,
                    message: format!(
                        "La propiedad «{}» es de tipo «{}»; el campo «{}» admite: {}.",
                        p.name,
                        p.kind,
                        spec.label,
                        spec.types.join(", ")
                    ),
                }),
                Some(p) => {
                    if p.name != fref.name {
                        issues.push(MappingIssue {
                            field: spec.key.into(),
                            severity: StepStatus::Ok,
                            message: format!("La propiedad «{}» se ha renombrado a «{}» (el mapeo sigue siendo válido).", fref.name, p.name),
                        });
                    }
                    if !spec.writable_types.contains(&p.kind.as_str()) {
                        issues.push(MappingIssue {
                            field: spec.key.into(),
                            severity: StepStatus::Warning,
                            message: format!("«{}» es de tipo «{}»: Lunar puede leerla pero no modificarla.", p.name, p.kind),
                        });
                    }
                }
            },
        }
    }
    issues
}

async fn check_role(client: &NotionClient, role: Role, cfg: &AppConfig, steps: &mut Vec<DiagnosticStep>) -> bool {
    let prefix = match role {
        Role::Movements => "movements",
        Role::Categories => "categories",
    };
    let label = role.label();
    let Some(src) = cfg.notion.source(role) else {
        let mut s = step(
            &format!("{prefix}.configured"),
            &format!("Fuente de {label}"),
            if role == Role::Movements { StepStatus::Error } else { StepStatus::Warning },
            format!("No hay ninguna base de datos de {label} configurada."),
        );
        s.hint = Some(match role {
            Role::Movements => "Elige tu base de datos de gastos en Ajustes → Conexión con Notion.".into(),
            Role::Categories => "Puedes crear la base de datos «Categorías» desde la pantalla Categorías.".into(),
        });
        steps.push(s);
        return false;
    };
    if normalize_notion_id(&src.data_source_id).is_none() {
        steps.push(failed(&format!("{prefix}.configured"), &format!("Fuente de {label}"), AppError::config("El identificador configurado no es válido.")));
        return false;
    }
    let schema = match retrieve_schema(client, &src.data_source_id).await {
        Ok(s) => s,
        Err(e) => {
            steps.push(failed(&format!("{prefix}.access"), &format!("Acceso a {label}"), e));
            return false;
        }
    };
    steps.push(step(
        &format!("{prefix}.access"),
        &format!("Acceso a {label}"),
        StepStatus::Ok,
        format!("La integración puede ver «{}» ({} propiedades).", schema.title, schema.properties.len()),
    ));

    let issues = check_mapping(role, src, &schema);
    let errors: Vec<_> = issues.iter().filter(|i| i.severity == StepStatus::Error).collect();
    let warnings: Vec<_> = issues.iter().filter(|i| i.severity == StepStatus::Warning).collect();
    let status = if !errors.is_empty() {
        StepStatus::Error
    } else if !warnings.is_empty() {
        StepStatus::Warning
    } else {
        StepStatus::Ok
    };
    let detail = if issues.is_empty() {
        "Todas las propiedades asignadas existen y tienen un tipo compatible.".to_string()
    } else {
        issues.iter().map(|i| i.message.clone()).collect::<Vec<_>>().join("\n")
    };
    let mut s = step(&format!("{prefix}.schema"), &format!("Esquema de {label}"), status, detail);
    if status == StepStatus::Error {
        s.hint = Some("Revisa el mapeo de propiedades en Ajustes → Conexión con Notion.".into());
    }
    steps.push(s);
    if status == StepStatus::Error {
        return false;
    }

    let query = client
        .post_read(&format!("/v1/data_sources/{}/query", normalize_notion_id(&src.data_source_id).unwrap_or_default()), &json!({ "page_size": 1 }))
        .await;
    match query {
        Ok(v) => {
            let n = v.get("results").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            let more = v.get("has_more").and_then(Value::as_bool).unwrap_or(false);
            steps.push(step(
                &format!("{prefix}.read"),
                &format!("Lectura de {label}"),
                StepStatus::Ok,
                if n == 0 { "La consulta funciona. La base de datos no tiene registros.".to_string() } else if more {
                    format!("La consulta funciona (se leen en bloques de {PAGE_SIZE}).")
                } else {
                    "La consulta funciona.".to_string()
                },
            ));
            true
        }
        Err(e) => {
            steps.push(failed(&format!("{prefix}.read"), &format!("Lectura de {label}"), e));
            false
        }
    }
}

pub async fn run(token: Result<String, AppError>, make_client: impl Fn(String) -> NotionClient, cfg: &AppConfig) -> DiagnosticReport {
    let mut steps = Vec::new();
    let mut report = DiagnosticReport { steps: Vec::new(), movements_ready: false, categories_ready: false, integration_name: None, workspace_name: None };

    let token = match token {
        Ok(t) => {
            steps.push(step("token", "Token guardado", StepStatus::Ok, "Hay un token en el Administrador de credenciales de Windows."));
            t
        }
        Err(e) => {
            steps.push(failed("token", "Token guardado", e));
            report.steps = steps;
            return report;
        }
    };
    let client = make_client(token);

    match client.get("/v1/users/me").await {
        Ok(me) => {
            report.integration_name = me.get("name").and_then(Value::as_str).map(str::to_string);
            report.workspace_name = me.get("bot").and_then(|b| b.get("workspace_name")).and_then(Value::as_str).map(str::to_string);
            let who = match (&report.integration_name, &report.workspace_name) {
                (Some(n), Some(w)) => format!("Integración «{n}» en el espacio «{w}»."),
                (Some(n), None) => format!("Integración «{n}»."),
                _ => "Token aceptado por Notion.".to_string(),
            };
            steps.push(step("auth", "Autenticación", StepStatus::Ok, who));
        }
        Err(e) => {
            steps.push(failed("auth", "Autenticación", e));
            report.steps = steps;
            return report;
        }
    }

    match list_sources(&client).await {
        Ok(list) if list.is_empty() => {
            let mut s = step("shared", "Bases de datos compartidas", StepStatus::Warning, "La integración no tiene ninguna base de datos compartida.");
            s.hint = Some("En Notion abre la base de datos de gastos → «···» → Conexiones → añade la integración.".into());
            steps.push(s);
        }
        Ok(list) => steps.push(step(
            "shared",
            "Bases de datos compartidas",
            StepStatus::Ok,
            format!("La integración puede ver {} fuente(s) de datos.", list.len()),
        )),
        Err(e) => steps.push(failed("shared", "Bases de datos compartidas", e)),
    }

    report.movements_ready = check_role(&client, Role::Movements, cfg, &mut steps).await;
    report.categories_ready = check_role(&client, Role::Categories, cfg, &mut steps).await;
    report.steps = steps;
    report
}

#[cfg(test)]
mod tests {
    use super::super::client::{RetryPolicy, build_http};
    use super::super::normalize::{fixtures::movements_schema, parse_schema};
    use super::*;
    use crate::config::{FieldRef, NotionConfig};
    use crate::error::ErrorCode;
    use mockito::Server;
    use std::time::Duration;

    const DS: &str = "0123456789abcdef0123456789abcdef";

    fn mapped_source() -> SourceConfig {
        let mut src = SourceConfig { data_source_id: DS.into(), ..Default::default() };
        for (k, id, name) in [
            ("description", "title", "Descripción"),
            ("date", "f%3Ae", "Fecha"),
            ("amount", "q%3Aa", "Cantidad"),
            ("kind", "t%3Ap", "Tipo"),
            ("category", "c%3At", "Categoría"),
            ("paymentMethod", "m%3Ap", "Método de Pago"),
        ] {
            src.fields.insert(k.into(), FieldRef { id: id.into(), name: name.into(), kind: String::new() });
        }
        src
    }

    #[test]
    fn mapping_matches_the_shortcut_schema() {
        let schema = parse_schema(&movements_schema()).unwrap();
        assert!(check_mapping(Role::Movements, &mapped_source(), &schema).is_empty());
    }

    #[test]
    fn mapping_detects_missing_wrong_type_and_renamed_properties() {
        let schema = parse_schema(&movements_schema()).unwrap();
        let mut src = mapped_source();
        src.fields.remove("date");
        src.fields.insert("amount".into(), FieldRef { id: "c%3At".into(), name: "Categoría".into(), kind: String::new() });
        src.fields.insert("category".into(), FieldRef { id: "gone".into(), name: "Vieja".into(), kind: String::new() });
        src.fields.insert("description".into(), FieldRef { id: "title".into(), name: "Concepto".into(), kind: String::new() });
        let issues = check_mapping(Role::Movements, &src, &schema);
        let by_field = |f: &str| issues.iter().filter(|i| i.field == f).collect::<Vec<_>>();
        assert_eq!(by_field("date")[0].severity, StepStatus::Error);
        assert!(by_field("amount")[0].message.contains("tipo «select»"));
        assert!(by_field("category")[0].message.contains("ya no existe"));
        assert_eq!(by_field("description")[0].severity, StepStatus::Ok);
    }

    fn make(server_url: String) -> impl Fn(String) -> NotionClient {
        move |t| {
            NotionClient::new(build_http(), &server_url, t).with_policy(RetryPolicy {
                max_retries: 0,
                base_delay: Duration::from_millis(1),
                max_wait: Duration::from_secs(1),
            })
        }
    }

    #[tokio::test]
    async fn stops_at_missing_token() {
        let r = run(Err(AppError::new(ErrorCode::NoToken, "sin token")), make("http://127.0.0.1:9".into()), &AppConfig::default()).await;
        assert_eq!(r.steps.len(), 1);
        assert_eq!(r.steps[0].status, StepStatus::Error);
        assert!(!r.movements_ready);
    }

    #[tokio::test]
    async fn stops_at_invalid_token() {
        let mut server = Server::new_async().await;
        let _m = server.mock("GET", "/v1/users/me").with_status(401).with_body(r#"{"code":"unauthorized","message":"API token is invalid."}"#).create_async().await;
        let r = run(Ok("ntn_x".into()), make(server.url()), &AppConfig::default()).await;
        let auth = r.steps.iter().find(|s| s.id == "auth").unwrap();
        assert_eq!(auth.status, StepStatus::Error);
        assert_eq!(auth.error.as_ref().unwrap().code, ErrorCode::InvalidToken);
    }

    #[tokio::test]
    async fn reports_unshared_database_as_access_error() {
        let mut server = Server::new_async().await;
        let _me = server.mock("GET", "/v1/users/me").with_body(r#"{"name":"Atajo iPhone","bot":{"workspace_name":"Diego"}}"#).create_async().await;
        let _search = server.mock("POST", "/v1/search").with_body(r#"{"results":[],"has_more":false}"#).create_async().await;
        let _ds = server
            .mock("GET", format!("/v1/data_sources/{DS}").as_str())
            .with_status(404)
            .with_body(r#"{"code":"object_not_found","message":"Could not find data_source"}"#)
            .create_async()
            .await;
        let cfg = AppConfig { version: 1, notion: NotionConfig { movements: Some(mapped_source()), categories: None } };
        let r = run(Ok("ntn_x".into()), make(server.url()), &cfg).await;
        assert_eq!(r.integration_name.as_deref(), Some("Atajo iPhone"));
        let shared = r.steps.iter().find(|s| s.id == "shared").unwrap();
        assert_eq!(shared.status, StepStatus::Warning);
        let access = r.steps.iter().find(|s| s.id == "movements.access").unwrap();
        assert_eq!(access.error.as_ref().unwrap().code, ErrorCode::NotFound);
        assert!(!r.movements_ready);
    }

    #[tokio::test]
    async fn full_success_path() {
        let mut server = Server::new_async().await;
        let _me = server.mock("GET", "/v1/users/me").with_body(r#"{"name":"Lunar"}"#).create_async().await;
        let mut ds = movements_schema();
        ds["id"] = serde_json::json!(DS);
        ds["url"] = serde_json::json!("https://notion.so/x");
        let mut summary = ds.clone();
        summary["object"] = serde_json::json!("data_source");
        let _search = server.mock("POST", "/v1/search").with_body(serde_json::json!({ "results": [summary], "has_more": false }).to_string()).create_async().await;
        let _schema = server.mock("GET", format!("/v1/data_sources/{DS}").as_str()).with_body(ds.to_string()).create_async().await;
        let _q = server
            .mock("POST", format!("/v1/data_sources/{DS}/query").as_str())
            .with_body(r#"{"results":[],"has_more":false,"next_cursor":null}"#)
            .create_async()
            .await;
        let cfg = AppConfig { version: 1, notion: NotionConfig { movements: Some(mapped_source()), categories: None } };
        let r = run(Ok("ntn_x".into()), make(server.url()), &cfg).await;
        assert!(r.movements_ready, "{:#?}", r.steps);
        assert!(!r.categories_ready);
        let read = r.steps.iter().find(|s| s.id == "movements.read").unwrap();
        assert!(read.detail.contains("no tiene registros"));
    }
}
