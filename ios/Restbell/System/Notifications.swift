import UserNotifications
import RestbellKit
import UIKit

/// Local notifications: rest-timer alerts, and the fallback for coach messages and the daily reminder
/// when the server can't push (no Home Assistant or ntfy configured).
final class Notifications: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = Notifications()
    let center = UNUserNotificationCenter.current()

    enum Mode: String, CaseIterable, Identifiable {
        /// The server pushes through Home Assistant or ntfy; the app only does the rest timer.
        case server
        /// The app checks in the background and posts the notifications itself (best effort).
        case local
        var id: String { rawValue }
        var title: String { self == .server ? "Server (Home Assistant or ntfy)" : "This iPhone (best effort)" }
    }

    var mode: Mode {
        get { Mode(rawValue: UserDefaults.standard.string(forKey: "notify.mode") ?? "") ?? .server }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "notify.mode") }
    }

    func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    // MARK: Rest timer

    func scheduleRestEnd(at date: Date, next: String) {
        let content = UNMutableNotificationContent()
        content.title = "Rest is over"
        content.body = next
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.userInfo = ["url": DeepLink.session.absoluteString]
        let interval = max(1, date.timeIntervalSinceNow)
        center.add(UNNotificationRequest(identifier: "rest", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)))
    }

    func cancelRestEnd() {
        center.removePendingNotificationRequests(withIdentifiers: ["rest"])
        center.removeDeliveredNotifications(withIdentifiers: ["rest"])
    }

    // MARK: Local fallback

    /// Post coach messages the phone hasn't announced yet (background refresh in local mode).
    func announceNewCoachMessages(_ messages: [ChatMessage]) {
        guard mode == .local else { return }
        let seen = UserDefaults.standard.integer(forKey: "notify.lastCoachId")
        let fresh = messages.filter { !$0.isMine && $0.readAt == nil && $0.id > seen && $0.kind != "error" }
        for m in fresh.suffix(3) {
            let content = UNMutableNotificationContent()
            content.title = m.kind == "review" ? "Your weekly review is in" : m.kind == "debrief" ? "Session debrief" : "Coach"
            content.body = m.text
            content.sound = .default
            content.threadIdentifier = "coach"
            content.userInfo = ["url": DeepLink.chat.absoluteString]
            center.add(UNNotificationRequest(identifier: "coach-\(m.id)", content: content, trigger: nil))
        }
        if let last = messages.map(\.id).max() { UserDefaults.standard.set(max(seen, last), forKey: "notify.lastCoachId") }
    }

    /// In local mode, keep one reminder scheduled at the reminder time for days with nothing logged.
    @MainActor
    func reconcileLocalReminder(summary: Summary, reminders: Reminders? = nil) {
        let id = "daily-reminder"
        center.removePendingNotificationRequests(withIdentifiers: [id])
        guard mode == .local else { return }
        let r = reminders ?? cachedReminders
        guard r.enabled else { return }
        let parts = r.time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        let loggedToday = summary.date == DayString.today()
            && (summary.food.entries > 0 || summary.session.status == "active" || summary.session.status == "done")
        var components = DateComponents()
        components.hour = parts[0]
        components.minute = parts[1]
        // Logged today: start tomorrow. The repeating trigger is re-checked every time the app refreshes.
        if loggedToday, let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) {
            let d = Calendar.current.dateComponents([.year, .month, .day], from: tomorrow)
            components.year = d.year; components.month = d.month; components.day = d.day
        }
        let content = UNMutableNotificationContent()
        content.title = "Restbell"
        content.body = "Nothing logged today yet. Meals, a weigh-in or a quick note all count."
        content.sound = .default
        content.userInfo = ["url": DeepLink.logFood.absoluteString]
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: !loggedToday)))
    }

    var cachedReminders: Reminders {
        get {
            UserDefaults.standard.data(forKey: "notify.reminders").flatMap { try? JSONDecoder().decode(Reminders.self, from: $0) }
                ?? Reminders(enabled: true, time: "20:30")
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "notify.reminders") }
    }

    // MARK: Delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // While resting in the app the timer is on screen; a banner on top would be noise.
        notification.request.identifier == "rest" ? [.sound] : [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let link = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: link) else { return }
        await MainActor.run { AppModel.shared.handle(url) }
    }
}
