import Foundation
#if canImport(Security)
import Security
#endif

/// The server token, kept in the Keychain in an access group the widget extension shares.
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

    public static var token: String? {
        get {
            var q = baseQuery()
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            SecItemDelete(baseQuery() as CFDictionary)
            guard let newValue, let data = newValue.data(using: .utf8) else { return }
            var q = baseQuery()
            q[kSecValueData as String] = data
            // Widgets refresh while the phone is locked, so the token must be readable after first unlock.
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(q as CFDictionary, nil)
        }
    }
    #else
    nonisolated(unsafe) static var memory: String?
    public static var token: String? {
        get { memory }
        set { memory = newValue }
    }
    #endif
}
