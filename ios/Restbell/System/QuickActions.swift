import UIKit
import RestbellKit

/// Long-press actions on the app icon: log food, one-tap favorites, start today's session.
@MainActor
enum QuickActions {
    static func update(favorites: [Summary.FavoriteRef], session: Summary.SessionInfo) {
        var items = [UIApplicationShortcutItem(type: "food.new", localizedTitle: "Log food", localizedSubtitle: nil,
                                               icon: UIApplicationShortcutIcon(systemImageName: "fork.knife"))]
        for f in favorites.prefix(2) {
            items.append(UIApplicationShortcutItem(type: "favorite", localizedTitle: f.name,
                                                   localizedSubtitle: "\(Int(f.kcal)) kcal · \(Int(f.proteinG)) g protein",
                                                   icon: UIApplicationShortcutIcon(systemImageName: "star.fill"),
                                                   userInfo: ["id": NSNumber(value: f.id)]))
        }
        if session.status == "planned" || session.status == "active", let title = session.title {
            items.append(UIApplicationShortcutItem(type: "session", localizedTitle: session.status == "active" ? "Resume session" : "Start session",
                                                   localizedSubtitle: title, icon: UIApplicationShortcutIcon(systemImageName: "figure.strengthtraining.traditional")))
        }
        UIApplication.shared.shortcutItems = items
    }

    static func handle(_ item: UIApplicationShortcutItem) {
        let model = AppModel.shared
        switch item.type {
        case "food.new": model.handle(DeepLink.logFood)
        case "session": model.handle(DeepLink.session)
        case "favorite":
            if let id = (item.userInfo?["id"] as? NSNumber)?.intValue { Task { await model.logFavorite(id: id) } }
        default: break
        }
    }
}
