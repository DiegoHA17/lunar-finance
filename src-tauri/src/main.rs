// Evita la ventana de consola adicional en Windows en las compilaciones de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lunar_lib::run();
}
