// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-vinted-webview",
  platforms: [
    .iOS(.v13)
  ],
  products: [
    .library(
      name: "tauri-plugin-vinted-webview",
      type: .static,
      targets: ["tauri-plugin-vinted-webview"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-vinted-webview",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
