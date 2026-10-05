import Foundation

/// Sets logged without a connection, kept on disk and sent later (the PWA does the same in localStorage).
public actor SetQueue {
    public struct Item: Codable, Hashable, Sendable {
        public var sessionId: Int
        public var set: LoggedSet
        public var queuedAt: Date
    }

    let url: URL
    private(set) var items: [Item]

    public init(directory: URL) {
        url = directory.appendingPathComponent("set-queue.json")
        items = (try? JSONDecoder().decode([Item].self, from: Data(contentsOf: url))) ?? []
    }

    public var count: Int { items.count }

    public func enqueue(sessionId: Int, _ set: LoggedSet) {
        // A re-log of the same set replaces the queued one.
        items.removeAll { $0.sessionId == sessionId && $0.set.exerciseId == set.exerciseId && $0.set.setIndex == set.setIndex }
        items.append(Item(sessionId: sessionId, set: set, queuedAt: Date()))
        save()
    }

    /// Send everything; items that still can't reach the server stay queued. Returns how many were sent.
    @discardableResult
    public func flush(using api: APIClient) async -> Int {
        var sent = 0
        var keep: [Item] = []
        for item in items {
            do {
                _ = try await api.logSet(sessionId: item.sessionId, item.set)
                sent += 1
            } catch let e as APIError where e.isOffline {
                keep.append(item)
            } catch {
                // The server refused it (session deleted or finished): drop it rather than retry forever.
            }
        }
        items = keep
        save()
        return sent
    }

    private func save() {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(items).write(to: url, options: .atomic)
    }
}
