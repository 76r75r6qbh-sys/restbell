import Foundation
#if canImport(Security)
import Security
#endif

/// The server token. Normally in the Keychain, in an access group the widget extension shares.
/// When that group isn't usable (an AltStore install re-signs the app with another team prefix), the app keeps
/// its own Keychain copy and also writes the token to a file in the App Group container, so widgets and Siri
/// can still reach the server. That container is readable only by apps signed by the same team.
public enum Credentials {
    static let service = "restbell.server"
    static let account = "token"

    static var accessGroup: String? {
        (Bundle.main.object(forInfoDictionaryKey: "RestbellKeychainGroup") as? String).flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 }
    }

    #if canImport(Security)
    static func baseQuery() -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    static func baseQuery(group: Bool) -> [String: Any] {
        var q = baseQuery()
        if !group { q.removeValue(forKey: kSecAttrAccessGroup as String) }
        return q
    }

    static func read(group: Bool) -> String? {
        var q = baseQuery(group: group)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func write(_ token: String?, group: Bool) -> Bool {
        SecItemDelete(baseQuery(group: group) as CFDictionary)
        guard let token, let data = token.data(using: .utf8) else { return true }
        var q = baseQuery(group: group)
        q[kSecValueData as String] = data
        // Widgets refresh while the phone is locked, so the token must be readable after first unlock.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    public static var token: String? {
        get { read(group: true) ?? TokenFile.read(in: AppGroup.containerURL) ?? read(group: false) }
        set {
            if accessGroup != nil, write(newValue, group: true) {
                TokenFile.write(nil, in: AppGroup.containerURL)
                return
            }
            // The shared Keychain group isn't available: keep the app's own copy plus the shared file.
            write(newValue, group: false)
            TokenFile.write(newValue, in: AppGroup.containerURL)
        }
    }
    #else
    public static var token: String? {
        get { TokenFile.read(in: AppGroup.containerURL) }
        set { TokenFile.write(newValue, in: AppGroup.containerURL) }
    }
    #endif
}

/// The token as a small file, for installs where the shared Keychain group can't be used.
public enum TokenFile {
    static let name = ".restbell-token"

    public static func read(in directory: URL) -> String? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    public static func write(_ token: String?, in directory: URL) {
        let url = directory.appendingPathComponent(name)
        guard let token else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        // Readable after the first unlock, like the Keychain item, so widgets can refresh while locked.
        try? Data(token.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? Data(token.utf8).write(to: url, options: .atomic)
        #endif
    }
}
