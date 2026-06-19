fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run GW-LINK OmniAI desktop app");
}
