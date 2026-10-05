import SwiftUI
import RestbellKit
import WidgetKit
import UserNotifications

enum AppTab: Hashable { case today, food, coach, more }

/// App-wide state: who we talk to, the latest summary, navigation and transient banners.
@Observable @MainActor
final class AppModel {
    static let shared = AppModel()

    var api: APIClient?
    var tab: AppTab = .today
    var summary: Summary?
    var today: Today?
    var loading = false
    var banner: String?
    var showLogFood = false
    var showWeighIn = false
    var showSession = false
    var coachSection: CoachSection = .chat
    let workout = WorkoutController()

    enum CoachSection: Hashable { case chat, notes }

    var isSignedIn: Bool { api != nil }
    var isDemo: Bool { SharedStore.demo }

    private init() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-demo") { SharedStore.demo = true }
        api = SharedStore.client()
        summary = SharedStore.cachedSummary
        // Screenshot automation: -tab food|coach|more, -screen session|logFood|trends.
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count {
            tab = ["food": .food, "coach": .coach, "more": .more][args[i + 1]] ?? .today
        }
        workout.app = self
    }

    // MARK: Sign in

    func signIn(server: String, password: String) async throws {
        var text = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "https://\(text)" }
        guard let url = URL(string: text), url.host != nil else { throw APIError.server(status: 0, message: "That doesn't look like a web address.") }
        let probe = APIClient(baseURL: url, token: nil)
        let health = try await probe.health()
        var token: String?
        if health.auth {
            token = try await APIClient.login(baseURL: url, password: password).token
        }
        Credentials.token = token
        SharedStore.serverURL = url
        SharedStore.demo = false
        api = SharedStore.client()
        await refresh()
        await HealthSync.shared.start()
    }

    func startDemo() async {
        SharedStore.demo = true
        api = SharedStore.client()
        await refresh()
    }

    func signOut() {
        Credentials.token = nil
        SharedStore.serverURL = nil
        SharedStore.demo = false
        SharedStore.cachedSummary = nil
        api = nil
        summary = nil
        today = nil
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Data

    func refresh() async {
        guard let api else { return }
        loading = true
        defer { loading = false }
        do {
            async let s = api.summary()
            async let t = api.today()
            let (summary, today) = try await (s, t)
            self.summary = summary
            self.today = today
            SharedStore.cachedSummary = summary
            WidgetCenter.shared.reloadAllTimelines()
            QuickActions.update(favorites: summary.favorites, session: summary.session)
            try? await UNUserNotificationCenter.current().setBadgeCount(summary.unreadChat)
            Notifications.shared.reconcileLocalReminder(summary: summary)
            await workout.restoreIfNeeded(today: today)
        } catch APIError.unauthorized {
            flash("Signed out: the server password changed.")
            signOut()
        } catch {
            flash(error.localizedDescription)
        }
    }

    /// Called after anything that changes today's numbers.
    func didLog() async {
        guard let api, let s = try? await api.summary() else { return }
        summary = s
        SharedStore.cachedSummary = s
        WidgetCenter.shared.reloadAllTimelines()
    }

    func flash(_ text: String) {
        banner = text
        Task {
            try? await Task.sleep(for: .seconds(3))
            if banner == text { banner = nil }
        }
    }

    // MARK: Deep links and quick actions

    func handle(_ url: URL) {
        guard url.scheme == "restbell" else { return }
        let path = ([url.host ?? ""] + url.pathComponents.filter { $0 != "/" }).joined(separator: "/")
        switch path {
        case "today": tab = .today
        case "food": tab = .food
        case "food/new": tab = .food; showLogFood = true
        case "chat": tab = .coach; coachSection = .chat
        case "coach": tab = .coach; coachSection = .notes
        case "weigh-in": tab = .today; showWeighIn = true
        case "session": tab = .today; showSession = today?.day != nil
        default: break
        }
    }

    func logFavorite(id: Int) async {
        guard let api else { return }
        let favorite = summary?.favorites.first { $0.id == id }
        do {
            let fav: Summary.FavoriteRef
            if let favorite { fav = favorite } else {
                guard let f = try await api.quickFoods().favorites.first(where: { $0.id == id }) else { return }
                fav = Summary.FavoriteRef(id: f.id, name: f.name, kcal: f.kcal, proteinG: f.proteinG)
            }
            _ = try await api.logFavorite(fav)
            HealthSync.shared.saveMealIfEnabled(kcal: fav.kcal, proteinG: fav.proteinG, name: fav.name)
            flash("Logged \(fav.name)")
            tab = .food
            await didLog()
        } catch {
            flash(error.localizedDescription)
        }
    }
}
