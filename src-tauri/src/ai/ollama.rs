//! Cliente de la API local oficial de Ollama (`http://127.0.0.1:11434/api`).
//!
//! Solo habla con el propio equipo: nunca envía datos a servicios remotos. Si Ollama no responde, el error se
//! devuelve y la aplicación sigue con el clasificador por reglas.

use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

pub const DEFAULT_URL: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    pub size: u64,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
    /// Capacidades que declara Ollama (`completion`, `vision`, `embedding`…). Vacío si la versión no las informa.
    pub capabilities: Vec<String>,
}

/// Evento de progreso real de una descarga (`POST /api/pull`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PullEvent {
    /// Estado sin cifras (p. ej. «pulling manifest», «verifying sha256 digest»).
    Status { status: String },
    /// Bytes reales de una capa.
    Progress { status: String, digest: String, completed: u64, total: u64 },
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyInput {
    pub description: String,
    pub amount: String,
    pub kind: String,
    #[serde(default)]
    pub payment_method: Option<String>,
    pub categories: Vec<CategoryOption>,
}

/// Nombre de categoría escrito en un movimiento que no está en el catálogo. Solo viaja el nombre (no importes,
/// fechas ni descripciones).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchCategoryInput {
    pub name: String,
    pub kind: String,
    pub categories: Vec<CategoryOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifySuggestion {
    /// `None` si el modelo no ve ninguna categoría adecuada.
    pub category_id: Option<String>,
    pub confidence: f64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePair {
    pub a: String,
    pub b: String,
    pub reason: String,
}

pub const NONE_CATEGORY: &str = "NINGUNA";

pub struct OllamaClient {
    http: reqwest::Client,
    base: String,
    request_timeout: Duration,
}

fn offline(e: &reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::new(ErrorCode::Server, "Ollama tardó demasiado en responder.").hint("Vuelve a intentarlo; la primera respuesta tras cargar el modelo es más lenta.")
    } else {
        AppError::new(ErrorCode::Offline, "Ollama no responde.").hint("Comprueba que Ollama está abierto y vuelve a intentarlo.")
    }
}

async fn api_error(resp: reqwest::Response) -> AppError {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let msg = body.get("error").and_then(Value::as_str).unwrap_or("").to_string();
    if status.as_u16() == 404 || msg.contains("not found") {
        return AppError::new(ErrorCode::NotFound, "El modelo no está instalado en Ollama.").hint("Descárgalo desde Ajustes → Inteligencia artificial.").detail(msg);
    }
    AppError::new(ErrorCode::Server, "Ollama devolvió un error.").detail(format!("HTTP {} · {}", status.as_u16(), msg))
}

impl OllamaClient {
    pub fn new(base: &str) -> Self {
        let http = reqwest::Client::builder().connect_timeout(Duration::from_secs(3)).build().expect("cliente HTTP");
        Self { http, base: base.trim_end_matches('/').to_string(), request_timeout: Duration::from_secs(90) }
    }

    #[cfg(test)]
    pub fn with_timeout(mut self, t: Duration) -> Self {
        self.request_timeout = t;
        self
    }

    pub async fn version(&self) -> AppResult<String> {
        let resp = self.http.get(format!("{}/api/version", self.base)).timeout(Duration::from_secs(4)).send().await.map_err(|e| offline(&e))?;
        if !resp.status().is_success() {
            return Err(api_error(resp).await);
        }
        let v: Value = resp.json().await.map_err(|_| AppError::new(ErrorCode::Server, "Respuesta de Ollama no válida."))?;
        Ok(v.get("version").and_then(Value::as_str).unwrap_or("desconocida").to_string())
    }

    pub async fn tags(&self) -> AppResult<Vec<LocalModel>> {
        let resp = self.http.get(format!("{}/api/tags", self.base)).timeout(Duration::from_secs(8)).send().await.map_err(|e| offline(&e))?;
        if !resp.status().is_success() {
            return Err(api_error(resp).await);
        }
        let v: Value = resp.json().await.map_err(|_| AppError::new(ErrorCode::Server, "Respuesta de Ollama no válida."))?;
        Ok(parse_tags(&v))
    }

    /// Descarga un modelo con progreso real. Devuelve `Ok(false)` si se canceló (la descarga se reanuda después).
    pub async fn pull(&self, model: &str, mut on_event: impl FnMut(PullEvent), cancel: &tokio::sync::watch::Receiver<bool>) -> AppResult<bool> {
        let mut cancel = cancel.clone();
        let req = self.http.post(format!("{}/api/pull", self.base)).json(&json!({ "model": model, "stream": true }));
        let mut resp = tokio::select! {
            r = req.send() => r.map_err(|e| offline(&e))?,
            _ = cancel.changed() => return Ok(false),
        };
        if !resp.status().is_success() {
            return Err(api_error(resp).await);
        }
        let mut buf: Vec<u8> = Vec::new();
        loop {
            let chunk = tokio::select! {
                c = resp.chunk() => c.map_err(|e| offline(&e))?,
                _ = cancel.changed() => return Ok(false),
            };
            let Some(bytes) = chunk else { break };
            buf.extend_from_slice(&bytes);
            while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buf.drain(..=pos).collect();
                if let Some(done) = handle_pull_line(&line, &mut on_event)? {
                    if done {
                        return Ok(true);
                    }
                }
            }
        }
        if !buf.is_empty() && handle_pull_line(&buf, &mut on_event)? == Some(true) {
            return Ok(true);
        }
        Err(AppError::new(ErrorCode::Server, "La descarga se interrumpió.").hint("Vuelve a intentarlo: Ollama reanuda desde donde se quedó."))
    }

    async fn chat_json(&self, model: &str, system: &str, user: &str, schema: Value) -> AppResult<Value> {
        let body = json!({
            "model": model,
            "stream": false,
            "format": schema,
            "options": { "temperature": 0 },
            "keep_alive": "10m",
            "messages": [ { "role": "system", "content": system }, { "role": "user", "content": user } ]
        });
        let resp = self
            .http
            .post(format!("{}/api/chat", self.base))
            .timeout(self.request_timeout)
            .json(&body)
            .send()
            .await
            .map_err(|e| offline(&e))?;
        if !resp.status().is_success() {
            return Err(api_error(resp).await);
        }
        let v: Value = resp.json().await.map_err(|_| invalid("la respuesta no es JSON"))?;
        let content = v.get("message").and_then(|m| m.get("content")).and_then(Value::as_str).ok_or_else(|| invalid("falta el contenido"))?;
        serde_json::from_str(content).map_err(|_| invalid("el contenido no cumple el formato"))
    }

    /// Pide una categoría de una lista cerrada. El esquema obliga a elegir un nombre de la lista o «NINGUNA»; aun
    /// así se vuelve a validar aquí (y en la interfaz) antes de usarla.
    pub async fn classify(&self, model: &str, input: &ClassifyInput) -> AppResult<ClassifySuggestion> {
        if input.categories.is_empty() {
            return Err(AppError::validation("No hay categorías disponibles para proponer."));
        }
        let mut names: Vec<String> = input.categories.iter().map(|c| c.name.clone()).collect();
        names.push(NONE_CATEGORY.to_string());
        let schema = json!({
            "type": "object",
            "properties": {
                "category": { "type": "string", "enum": names },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                "reason": { "type": "string", "maxLength": 160 }
            },
            "required": ["category", "confidence", "reason"]
        });
        let system = "Clasificas movimientos bancarios personales en España. Elige exactamente una categoría de la lista dada \
            o NINGUNA si ninguna encaja claramente. No inventes categorías. Prefiere la categoría más específica: \
            comer o beber fuera (bares, restaurantes, cafeterías) no es lo mismo que comprar comida en una tienda. \
            confidence es tu certeza real entre 0 y 1: usa valores bajos si dudas. reason es una frase breve en español.";
        let user = format!(
            "Movimiento:\n- Descripción: {}\n- Importe: {} €\n- Tipo: {}\n- Método de pago: {}\nCategorías: {}",
            truncate(&input.description, 200),
            truncate(&input.amount, 20),
            truncate(&input.kind, 20),
            truncate(input.payment_method.as_deref().unwrap_or("—"), 40),
            input.categories.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ")
        );
        let v = self.chat_json(model, system, &user, schema).await?;
        validate_suggestion(&v, &input.categories)
    }

    /// ¿A qué categoría existente corresponde un nombre que no está en el catálogo? Misma lista cerrada y validación
    /// que `classify`; «NINGUNA» si no es claramente la misma.
    pub async fn match_category(&self, model: &str, input: &MatchCategoryInput) -> AppResult<ClassifySuggestion> {
        if input.categories.is_empty() {
            return Err(AppError::validation("No hay categorías disponibles para proponer."));
        }
        let mut names: Vec<String> = input.categories.iter().map(|c| c.name.clone()).collect();
        names.push(NONE_CATEGORY.to_string());
        let schema = json!({
            "type": "object",
            "properties": {
                "category": { "type": "string", "enum": names },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                "reason": { "type": "string", "maxLength": 160 }
            },
            "required": ["category", "confidence", "reason"]
        });
        let system = "Revisas el catálogo de categorías de finanzas personales de una persona en España. Te doy un nombre de \
            categoría escrito a mano que NO existe en el catálogo y la lista de categorías existentes. Elige la categoría \
            existente solo si el nombre es claramente la misma: errata, plural, abreviatura o sinónimo directo. Si podría \
            corresponder a varias, es más general o más específica, o no encaja, responde NINGUNA. No inventes categorías. \
            confidence es tu certeza real entre 0 y 1. reason es una frase breve en español.";
        let user = format!(
            "Nombre escrito: «{}»\nTipo: {}\nCategorías existentes: {}",
            truncate(&input.name, 80),
            truncate(&input.kind, 20),
            input.categories.iter().map(|c| truncate(&c.name, 60)).collect::<Vec<_>>().join(", ")
        );
        let v = self.chat_json(model, system, &user, schema).await?;
        validate_suggestion(&v, &input.categories)
    }

    /// Posibles categorías duplicadas por nombre o significado. Solo propone: no cambia nada.
    pub async fn review_duplicates(&self, model: &str, names: &[String]) -> AppResult<Vec<DuplicatePair>> {
        if names.len() < 2 {
            return Ok(Vec::new());
        }
        let schema = json!({
            "type": "object",
            "properties": {
                "pairs": { "type": "array", "maxItems": 20, "items": {
                    "type": "object",
                    "properties": {
                        "a": { "type": "string", "enum": names },
                        "b": { "type": "string", "enum": names },
                        "reason": { "type": "string", "maxLength": 120 }
                    },
                    "required": ["a", "b", "reason"]
                } }
            },
            "required": ["pairs"]
        });
        let system = "Revisas una lista de categorías de gastos personales. Devuelve solo pares que sean claramente la misma \
            categoría con distinto nombre (sinónimos, singular/plural, idiomas). Si no hay ninguno, devuelve una lista vacía.";
        let user = format!("Categorías: {}", names.iter().map(|n| truncate(n, 60)).collect::<Vec<_>>().join(", "));
        let v = self.chat_json(model, system, &user, schema).await?;
        let mut out = Vec::new();
        for p in v.get("pairs").and_then(Value::as_array).cloned().unwrap_or_default() {
            let (Some(a), Some(b)) = (p.get("a").and_then(Value::as_str), p.get("b").and_then(Value::as_str)) else { continue };
            if a == b || !names.iter().any(|n| n == a) || !names.iter().any(|n| n == b) {
                continue;
            }
            out.push(DuplicatePair { a: a.into(), b: b.into(), reason: p.get("reason").and_then(Value::as_str).unwrap_or("").chars().take(160).collect() });
        }
        Ok(out)
    }
}

fn invalid(what: &str) -> AppError {
    AppError::new(ErrorCode::Validation, "Respuesta del modelo no válida.").detail(what.to_string())
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect::<String>().replace('\n', " ")
}

/// Comprueba la forma de la respuesta y que la categoría pertenece a la lista ofrecida.
pub fn validate_suggestion(v: &Value, categories: &[CategoryOption]) -> AppResult<ClassifySuggestion> {
    let name = v.get("category").and_then(Value::as_str).ok_or_else(|| invalid("falta «category»"))?;
    let confidence = v.get("confidence").and_then(Value::as_f64).ok_or_else(|| invalid("falta «confidence»"))?;
    if !(0.0..=1.0).contains(&confidence) {
        return Err(invalid("confianza fuera de rango"));
    }
    let reason: String = v.get("reason").and_then(Value::as_str).unwrap_or("").chars().take(200).collect();
    if name == NONE_CATEGORY {
        return Ok(ClassifySuggestion { category_id: None, confidence, reason });
    }
    let cat = categories.iter().find(|c| c.name == name).ok_or_else(|| invalid("categoría inexistente"))?;
    Ok(ClassifySuggestion { category_id: Some(cat.id.clone()), confidence, reason })
}

/// Procesa una línea NDJSON de `/api/pull`. `Some(true)` = terminado; error si Ollama informa de uno.
fn handle_pull_line(line: &[u8], on_event: &mut impl FnMut(PullEvent)) -> AppResult<Option<bool>> {
    let text = String::from_utf8_lossy(line);
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(text).map_err(|_| AppError::new(ErrorCode::Server, "Respuesta de Ollama no válida durante la descarga."))?;
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        let not_found = err.contains("file does not exist") || err.contains("not found");
        return Err(if not_found {
            AppError::new(ErrorCode::NotFound, "Ese modelo no existe en el catálogo de Ollama.").detail(err.to_string())
        } else {
            AppError::new(ErrorCode::Server, "La descarga falló.").hint("Comprueba la conexión y el espacio libre, y vuelve a intentarlo.").detail(err.to_string())
        });
    }
    let status = v.get("status").and_then(Value::as_str).unwrap_or("").to_string();
    if status == "success" {
        on_event(PullEvent::Done);
        return Ok(Some(true));
    }
    match (v.get("digest").and_then(Value::as_str), v.get("total").and_then(Value::as_u64)) {
        (Some(d), Some(total)) => on_event(PullEvent::Progress {
            status,
            digest: d.to_string(),
            completed: v.get("completed").and_then(Value::as_u64).unwrap_or(0),
            total,
        }),
        _ => on_event(PullEvent::Status { status }),
    }
    Ok(Some(false))
}

pub fn parse_tags(v: &Value) -> Vec<LocalModel> {
    let mut out = Vec::new();
    for m in v.get("models").and_then(Value::as_array).cloned().unwrap_or_default() {
        let Some(name) = m.get("name").or_else(|| m.get("model")).and_then(Value::as_str) else { continue };
        let details = m.get("details").cloned().unwrap_or(Value::Null);
        let s = |k: &str| details.get(k).and_then(Value::as_str).map(str::to_string);
        out.push(LocalModel {
            name: name.to_string(),
            size: m.get("size").and_then(Value::as_u64).unwrap_or(0),
            family: s("family"),
            parameter_size: s("parameter_size"),
            quantization: s("quantization_level"),
            capabilities: m
                .get("capabilities")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn cats() -> Vec<CategoryOption> {
        vec![CategoryOption { id: "c1".into(), name: "Alimentación".into() }, CategoryOption { id: "c2".into(), name: "Ocio".into() }]
    }

    fn input() -> ClassifyInput {
        ClassifyInput { description: "Bolera Ocio Park".into(), amount: "12,50".into(), kind: "Gasto".into(), payment_method: None, categories: cats() }
    }

    fn chat_reply(content: &str) -> String {
        json!({ "model": "gemma3:4b", "message": { "role": "assistant", "content": content }, "done": true, "done_reason": "stop" }).to_string()
    }

    #[tokio::test]
    async fn reports_version_and_models() {
        let mut s = Server::new_async().await;
        let _v = s.mock("GET", "/api/version").with_body(r#"{"version":"0.40.6"}"#).create_async().await;
        let _t = s
            .mock("GET", "/api/tags")
            .with_body(
                json!({ "models": [
                    { "name": "gemma3:4b", "size": 3350272403u64, "details": { "family": "gemma3", "parameter_size": "3.9B", "quantization_level": "Q4_K_M" }, "capabilities": ["completion", "vision"] },
                    { "name": "nomic-embed-text:latest", "size": 274302450, "details": { "family": "nomic-bert" } }
                ] })
                .to_string(),
            )
            .create_async()
            .await;
        let c = OllamaClient::new(&s.url());
        assert_eq!(c.version().await.unwrap(), "0.40.6");
        let models = c.tags().await.unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "gemma3:4b");
        assert_eq!(models[0].capabilities, vec!["completion", "vision"]);
        assert!(models[1].capabilities.is_empty());
    }

    #[tokio::test]
    async fn stopped_service_is_offline() {
        let c = OllamaClient::new("http://127.0.0.1:9");
        assert_eq!(c.version().await.unwrap_err().code, ErrorCode::Offline);
        assert_eq!(c.tags().await.unwrap_err().code, ErrorCode::Offline);
    }

    #[tokio::test]
    async fn classify_maps_the_name_to_its_id() {
        let mut s = Server::new_async().await;
        let m = s
            .mock("POST", "/api/chat")
            .match_body(Matcher::PartialJson(json!({ "model": "gemma3:4b", "stream": false, "options": { "temperature": 0 } })))
            .with_body(chat_reply(r#"{"category":"Ocio","confidence":0.91,"reason":"Bolera: actividad de ocio"}"#))
            .create_async()
            .await;
        let r = OllamaClient::new(&s.url()).classify("gemma3:4b", &input()).await.unwrap();
        assert_eq!(r.category_id.as_deref(), Some("c2"));
        assert!((r.confidence - 0.91).abs() < 1e-9);
        m.assert_async().await;
    }

    #[tokio::test]
    async fn classify_accepts_none_and_rejects_invented_or_malformed_answers() {
        let mut s = Server::new_async().await;
        let _m = s.mock("POST", "/api/chat").with_body(chat_reply(r#"{"category":"NINGUNA","confidence":0.3,"reason":"ambiguo"}"#)).create_async().await;
        let r = OllamaClient::new(&s.url()).classify("m", &input()).await.unwrap();
        assert_eq!(r.category_id, None);

        for content in [r#"{"category":"Mascotas","confidence":0.9,"reason":"x"}"#, r#"no es json"#, r#"{"category":"Ocio","confidence":7,"reason":"x"}"#, r#"{"confidence":0.5}"#] {
            let mut s = Server::new_async().await;
            let _m = s.mock("POST", "/api/chat").with_body(chat_reply(content)).create_async().await;
            let err = OllamaClient::new(&s.url()).classify("m", &input()).await.unwrap_err();
            assert_eq!(err.code, ErrorCode::Validation, "{content}");
        }
    }

    #[tokio::test]
    async fn missing_model_is_reported() {
        let mut s = Server::new_async().await;
        let _m = s.mock("POST", "/api/chat").with_status(404).with_body(r#"{"error":"model \"gemma3:1b\" not found, try pulling it first"}"#).create_async().await;
        let err = OllamaClient::new(&s.url()).classify("gemma3:1b", &input()).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[tokio::test]
    async fn classify_times_out() {
        // Servidor que acepta la conexión y nunca responde.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let _conns: Vec<_> = listener.incoming().take(1).collect();
            std::thread::sleep(Duration::from_secs(5));
        });
        let c = OllamaClient::new(&format!("http://{addr}")).with_timeout(Duration::from_millis(300));
        let err = c.classify("m", &input()).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Server);
        assert!(err.message.contains("tardó"));
    }

    #[tokio::test]
    async fn pull_reports_real_progress_and_success() {
        let mut s = Server::new_async().await;
        let body = [
            r#"{"status":"pulling manifest"}"#,
            r#"{"status":"pulling aaa","digest":"sha256:aaa","total":1000,"completed":250}"#,
            r#"{"status":"pulling aaa","digest":"sha256:aaa","total":1000,"completed":1000}"#,
            r#"{"status":"verifying sha256 digest"}"#,
            r#"{"status":"success"}"#,
        ]
        .join("\n");
        let _m = s.mock("POST", "/api/pull").match_body(Matcher::PartialJson(json!({ "model": "gemma3:1b" }))).with_body(body).create_async().await;
        let (_tx, rx) = tokio::sync::watch::channel(false);
        let mut events = Vec::new();
        let done = OllamaClient::new(&s.url()).pull("gemma3:1b", |e| events.push(e), &rx).await.unwrap();
        assert!(done);
        assert_eq!(events[1], PullEvent::Progress { status: "pulling aaa".into(), digest: "sha256:aaa".into(), completed: 250, total: 1000 });
        assert_eq!(events.last(), Some(&PullEvent::Done));
    }

    #[tokio::test]
    async fn pull_errors_are_reported() {
        let mut s = Server::new_async().await;
        let _m = s.mock("POST", "/api/pull").with_body("{\"status\":\"pulling manifest\"}\n{\"error\":\"pull model manifest: file does not exist\"}\n").create_async().await;
        let (_tx, rx) = tokio::sync::watch::channel(false);
        let err = OllamaClient::new(&s.url()).pull("no-existe:1b", |_| {}, &rx).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);

        let mut s = Server::new_async().await;
        let _m = s.mock("POST", "/api/pull").with_body("{\"status\":\"pulling manifest\"}\n").create_async().await;
        let err = OllamaClient::new(&s.url()).pull("x", |_| {}, &rx).await.unwrap_err();
        assert!(err.message.contains("interrumpió"));
    }

    #[tokio::test]
    async fn pull_can_be_cancelled() {
        // Servidor que envía una línea de progreso y se queda abierto.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf).await;
            let line = "{\"status\":\"pulling a\",\"digest\":\"a\",\"total\":10,\"completed\":1}\n";
            let head = format!("HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\n\r\n{:x}\r\n{line}\r\n", line.len());
            let _ = sock.write_all(head.as_bytes()).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let (tx, rx) = tokio::sync::watch::channel(false);
        let canceller = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            tx.send(true).unwrap();
        });
        let mut events = Vec::new();
        let done = OllamaClient::new(&format!("http://{addr}")).pull("gemma3:1b", |e| events.push(e), &rx).await.unwrap();
        canceller.await.unwrap();
        assert!(!done, "una descarga cancelada no se da por terminada");
        assert!(matches!(events.first(), Some(PullEvent::Progress { .. })));
    }

    /// Prueba real contra el Ollama local con datos sintéticos. Se ejecuta a mano:
    /// `LUNAR_OLLAMA_MODEL=gemma3:4b cargo test -- --ignored real_ollama`
    #[tokio::test]
    #[ignore]
    async fn real_ollama_classifies_a_synthetic_movement() {
        let model = std::env::var("LUNAR_OLLAMA_MODEL").unwrap_or_else(|_| "gemma3:4b".into());
        let c = OllamaClient::new(DEFAULT_URL);
        let version = c.version().await.expect("Ollama en marcha");
        let models = c.tags().await.unwrap();
        assert!(models.iter().any(|m| m.name == model), "modelo {model} no instalado");
        let cats = vec![
            CategoryOption { id: "a".into(), name: "Alimentación".into() },
            CategoryOption { id: "t".into(), name: "Transporte".into() },
            CategoryOption { id: "o".into(), name: "Ocio".into() },
            CategoryOption { id: "s".into(), name: "Suscripciones".into() },
        ];
        let start = std::time::Instant::now();
        let r = c
            .classify(&model, &ClassifyInput { description: "Billete tren Renfe Madrid-Toledo".into(), amount: "13,90".into(), kind: "Gasto".into(), payment_method: Some("Tarjeta".into()), categories: cats.clone() })
            .await
            .unwrap();
        println!("Ollama {version} · {model} · {:?} · {:?}", start.elapsed(), r);
        assert_eq!(r.category_id.as_deref(), Some("t"));
        let pairs = c.review_duplicates(&model, &["Alimentación".into(), "Comida".into(), "Transporte".into(), "Ocio".into()]).await.unwrap();
        println!("duplicados: {pairs:?}");
        let food = vec![
            CategoryOption { id: "a".into(), name: "Alimentación".into() },
            CategoryOption { id: "r".into(), name: "Restaurantes".into() },
            CategoryOption { id: "s".into(), name: "Salud".into() },
            CategoryOption { id: "p".into(), name: "Ropa".into() },
        ];
        for d in ["Bar Manolo", "Óptica", "Mercadona"] {
            let r = c
                .classify(&model, &ClassifyInput { description: d.into(), amount: "12,00".into(), kind: "Gasto".into(), payment_method: None, categories: food.clone() })
                .await
                .unwrap();
            println!("{d} -> {:?} ({:.2}) {}", r.category_id, r.confidence, r.reason);
        }
        let mut all = food.clone();
        all.extend(cats.iter().cloned());
        for name in ["Restaurante", "Comida fuera", "Varios", "Transprte"] {
            let r = c.match_category(&model, &MatchCategoryInput { name: name.into(), kind: "Gasto".into(), categories: all.clone() }).await.unwrap();
            println!("categoría «{name}» -> {:?} ({:.2}) {}", r.category_id, r.confidence, r.reason);
        }
    }

    #[tokio::test]
    async fn match_category_sends_only_names_and_validates_the_answer() {
        let mut s = Server::new_async().await;
        let m = s
            .mock("POST", "/api/chat")
            .match_body(Matcher::Regex("Ocios".into()))
            .with_body(chat_reply(r#"{"category":"Ocio","confidence":0.93,"reason":"Plural de Ocio"}"#))
            .create_async()
            .await;
        let input = MatchCategoryInput { name: "Ocios".into(), kind: "Gasto".into(), categories: cats() };
        let r = OllamaClient::new(&s.url()).match_category("m", &input).await.unwrap();
        assert_eq!(r.category_id.as_deref(), Some("c2"));
        m.assert_async().await;

        for content in [r#"{"category":"Diversión","confidence":0.9,"reason":"inventada"}"#, r#"{"category":"Ocio","confidence":2,"reason":"x"}"#] {
            let mut s = Server::new_async().await;
            let _m = s.mock("POST", "/api/chat").with_body(chat_reply(content)).create_async().await;
            assert_eq!(OllamaClient::new(&s.url()).match_category("m", &input).await.unwrap_err().code, ErrorCode::Validation);
        }
        let mut s = Server::new_async().await;
        let _m = s.mock("POST", "/api/chat").with_body(chat_reply(r#"{"category":"NINGUNA","confidence":0.4,"reason":"ambiguo"}"#)).create_async().await;
        assert_eq!(OllamaClient::new(&s.url()).match_category("m", &input).await.unwrap().category_id, None);
    }

    #[tokio::test]
    async fn duplicate_review_only_returns_pairs_from_the_list() {
        let mut s = Server::new_async().await;
        let _m = s
            .mock("POST", "/api/chat")
            .with_body(chat_reply(r#"{"pairs":[{"a":"Comida","b":"Alimentación","reason":"sinónimos"},{"a":"Ocio","b":"Ocio","reason":"igual"},{"a":"Ocio","b":"Fiesta","reason":"inventada"}]}"#))
            .create_async()
            .await;
        let names = vec!["Alimentación".to_string(), "Comida".to_string(), "Ocio".to_string()];
        let pairs = OllamaClient::new(&s.url()).review_duplicates("m", &names).await.unwrap();
        assert_eq!(pairs, vec![DuplicatePair { a: "Comida".into(), b: "Alimentación".into(), reason: "sinónimos".into() }]);
    }
}
