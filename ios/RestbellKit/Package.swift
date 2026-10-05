// swift-tools-version:6.0
// Shared code for the Restbell app and its widget extension. Everything outside the Apple-only files
// (Keychain, App Group store) builds on Linux too, so `swift test` runs anywhere.
import PackageDescription

let package = Package(
    name: "RestbellKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "RestbellKit", targets: ["RestbellKit"])],
    targets: [
        .target(name: "RestbellKit"),
        .testTarget(name: "RestbellKitTests", dependencies: ["RestbellKit"]),
    ],
    // Swift 5 mode keeps strict-concurrency checks as warnings while the app targets also build in Swift 5 mode.
    swiftLanguageModes: [.v5]
)
