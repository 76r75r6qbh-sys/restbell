import WidgetKit
import RestbellKit

struct SummaryEntry: TimelineEntry {
    var date: Date
    var summary: Summary
    /// False when we're showing the cache because the server couldn't be reached.
    var fresh: Bool
    var signedIn: Bool
}

/// Fetches /api/summary with the token the app shares through the Keychain; falls back to the cache.
struct SummaryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: .now, summary: .sample(), fresh: true, signedIn: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(await entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        Task {
            let e = await entry()
            // Every 30 minutes; the app also reloads widgets after every log.
            completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(30 * 60))))
        }
    }

    func entry() async -> SummaryEntry {
        guard let api = SharedStore.client() else {
            return SummaryEntry(date: .now, summary: .sample(), fresh: false, signedIn: false)
        }
        if let s = try? await api.summary() {
            SharedStore.cachedSummary = s
            return SummaryEntry(date: .now, summary: s, fresh: true, signedIn: true)
        }
        let cached = SharedStore.cachedSummary
        // Yesterday's cache would show the wrong day: show zeros for food instead.
        if var c = cached, c.date != DayString.today() {
            c.food.kcal = 0
            c.food.proteinG = 0
            c.food.entries = 0
            c.date = DayString.today()
            return SummaryEntry(date: .now, summary: c, fresh: false, signedIn: true)
        }
        return SummaryEntry(date: .now, summary: cached ?? .sample(), fresh: false, signedIn: cached != nil)
    }
}
