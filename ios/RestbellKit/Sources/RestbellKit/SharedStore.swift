import Foundation

/// Settings shared between the app and the widget extension through the App Group.
/// Identifiers come from Info.plist (set from the xcconfig), so each developer can use their own bundle prefix.
public enum AppGroup {
    public static var identifier: String? { Bundle.main.object(forInfoDictionaryKey: "RestbellAppGroup") as? String }

    public static var defaults: UserDefaults {
        identifier.flatMap { UserDefaults(suiteName: $0) } ?? .standard
    }

    public static var containerURL: URL {
        #if os(iOS) || os(macOS)
        if let id = identifier, let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) { return url }
        #endif
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }
}

public enum SharedStore {
    static let serverKey = "serverURL"
    static let summaryKey = "summary.cache"
    static let demoKey = "demo"

    public static var serverURL: URL? {
        get { AppGroup.defaults.string(forKey: serverKey).flatMap(URL.init(string:)) }
        set { AppGroup.defaults.set(newValue?.absoluteString, forKey: serverKey) }
    }

    /// Demo mode serves canned data (screenshots, trying the app without a server).
    public static var demo: Bool {
        get { AppGroup.defaults.bool(forKey: demoKey) }
        set { AppGroup.defaults.set(newValue, forKey: demoKey) }
    }

    /// The last summary, so widgets render instantly and offline.
    public static var cachedSummary: Summary? {
        get { AppGroup.defaults.data(forKey: summaryKey).flatMap { try? JSONDecoder().decode(Summary.self, from: $0) } }
        set { AppGroup.defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: summaryKey) }
    }

    /// The client for whoever is signed in, or the demo server.
    public static func client() -> APIClient? {
        if demo { return APIClient(baseURL: DemoServer.baseURL, token: nil, transport: DemoServer.shared) }
        guard let url = serverURL else { return nil }
        return APIClient(baseURL: url, token: Credentials.token)
    }
}
