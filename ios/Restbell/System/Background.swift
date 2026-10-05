import BackgroundTasks
import RestbellKit
import UIKit
import WidgetKit
import UserNotifications

/// Background work: an hourly refresh (Health sync, widget data, local notifications) and a nightly
/// 30-day Health reconcile. iOS decides the exact timing; HealthKit background delivery and the
/// Shortcuts automation cover the gaps.
enum Background {
    static let refreshId = "restbell.refresh"
    static let reconcileId = "restbell.reconcile"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshId, using: nil) { task in
            scheduleRefresh()
            let work = Task {
                await HealthSync.shared.sync(trigger: .backgroundRefresh)
                await refreshSummaryAndNotify()
            }
            task.expirationHandler = { work.cancel() }
            Task {
                await work.value
                task.setTaskCompleted(success: true)
            }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: reconcileId, using: nil) { task in
            scheduleReconcile()
            let work = Task { await HealthSync.shared.sync(trigger: .nightly, days: 30) }
            task.expirationHandler = { work.cancel() }
            Task {
                await work.value
                task.setTaskCompleted(success: true)
            }
        }
    }

    static func scheduleAll() {
        scheduleRefresh()
        scheduleReconcile()
    }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3600)
        try? BGTaskScheduler.shared.submit(request)
    }

    static func scheduleReconcile() {
        let request = BGProcessingTaskRequest(identifier: reconcileId)
        var next = Calendar.current.nextDate(after: Date(), matching: DateComponents(hour: 4), matchingPolicy: .nextTime) ?? Date(timeIntervalSinceNow: 6 * 3600)
        if next.timeIntervalSinceNow < 3600 { next.addTimeInterval(86400) }
        request.earliestBeginDate = next
        request.requiresNetworkConnectivity = true
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Widget data, the unread badge and (in local mode) coach notifications and the reminder.
    static func refreshSummaryAndNotify() async {
        guard let api = SharedStore.client(), let summary = try? await api.summary() else { return }
        SharedStore.cachedSummary = summary
        WidgetCenter.shared.reloadAllTimelines()
        await MainActor.run {
            AppModel.shared.summary = summary
            Notifications.shared.reconcileLocalReminder(summary: summary)
        }
        try? await UNUserNotificationCenter.current().setBadgeCount(summary.unreadChat)
        if Notifications.shared.mode == .local, summary.unreadChat > 0, let page = try? await api.chat(limit: 10) {
            Notifications.shared.announceNewCoachMessages(page.messages)
        }
    }
}
