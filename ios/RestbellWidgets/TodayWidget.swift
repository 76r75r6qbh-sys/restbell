import SwiftUI
import WidgetKit
import AppIntents
import RestbellKit

/// Home Screen: today's calories and protein, the session, and one-tap favorites.
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: SummaryProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Calories, protein and today's session. The medium size logs your favorites in one tap.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TodayWidgetView: View {
    var entry: SummaryEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    var s: Summary { entry.summary }

    var body: some View {
        if !entry.signedIn {
            VStack(spacing: 6) {
                Image(systemName: "person.crop.circle.badge.questionmark").font(.title)
                Text("Open Restbell to sign in").font(.caption).multilineTextAlignment(.center)
            }
            .foregroundStyle(.secondary)
        } else {
            switch family {
            case .systemSmall: small
            case .systemLarge: large
            default: medium
            }
        }
    }

    var rings: some View {
        RingStack(rings: [
            .init(id: "kcal", progress: s.food.kcalProgress, color: Palette.kcal),
            .init(id: "protein", progress: s.food.proteinProgress, color: Palette.protein),
        ], lineWidth: 9)
        .widgetAccentable()
    }

    var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                rings.frame(width: 60)
                Spacer()
                if let r = s.recovery {
                    Circle().fill(Palette.recovery(r.level)).frame(width: 10, height: 10).accessibilityLabel("Recovery \(r.level)")
                }
            }
            Spacer(minLength: 0)
            MacroLine(label: "Calories", value: s.food.kcal, target: s.food.targets.kcal, unit: "kcal", color: Palette.kcal, compact: true)
            MacroLine(label: "Protein", value: s.food.proteinG, target: s.food.targets.proteinG, unit: "g", color: Palette.protein, compact: true)
        }
        .widgetURL(DeepLink.food)
    }

    var medium: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                MacroRings(food: s.food, compact: true)
                Spacer(minLength: 0)
                sessionBlock
            }
            favoritesRow
        }
    }

    var large: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                MacroRings(food: s.food)
                Spacer(minLength: 0)
                if s.activity.hasRings {
                    RingStack(rings: s.activity.rings, lineWidth: 8).frame(width: 64).widgetAccentable()
                }
            }
            Divider()
            HStack(alignment: .top) {
                sessionBlock
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Week \(s.week.done)/\(s.week.planned)").font(.subheadline.weight(.semibold)).numeric()
                    Label("\(s.streak)", systemImage: "flame.fill").font(.subheadline).foregroundStyle(.orange).numeric()
                }
            }
            if let r = s.recovery {
                Label {
                    Text("Recovery \(r.score) · \(r.reasons.first ?? (r.level == "good" ? "ready to train" : r.level))").lineLimit(1)
                } icon: {
                    Image(systemName: "heart.text.square.fill").foregroundStyle(Palette.recovery(r.level))
                }
                .font(.footnote)
            }
            Spacer(minLength: 0)
            favoritesRow
        }
    }

    var sessionBlock: some View {
        Link(destination: s.session.status == "rest" ? DeepLink.today : DeepLink.session) {
            VStack(alignment: .leading, spacing: 2) {
                Text(sessionStatus).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                Text(s.session.title ?? "Rest day").font(.subheadline.weight(.semibold)).lineLimit(2)
                if s.session.status == "active", let total = s.session.setsTotal {
                    Text("\(s.session.setsDone ?? 0)/\(total) sets").font(.caption).foregroundStyle(.secondary).numeric()
                } else {
                    Text("Week \(s.week.done)/\(s.week.planned) · \(s.streak)🔥").font(.caption).foregroundStyle(.secondary).numeric()
                }
            }
        }
    }

    var sessionStatus: String {
        switch s.session.status {
        case "active": "In progress"
        case "done": "Done"
        case "planned": s.session.time ?? "Today"
        default: "Today"
        }
    }

    var favoritesRow: some View {
        HStack(spacing: 6) {
            ForEach(s.favorites.prefix(3)) { f in
                Button(intent: LogFavoriteIntent(meal: FavoriteEntity(f))) {
                    VStack(spacing: 1) {
                        Text(f.name).font(.caption2.weight(.semibold)).lineLimit(1)
                        Text("\(Int(f.kcal)) kcal").font(.system(size: 9)).foregroundStyle(.secondary).numeric()
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Palette.protein)
            }
            if s.favorites.isEmpty {
                Link(destination: DeepLink.logFood) {
                    Label("Log food", systemImage: "plus").font(.caption.weight(.semibold)).frame(maxWidth: .infinity)
                }
            }
        }
    }
}

#Preview(as: .systemMedium) {
    TodayWidget()
} timeline: {
    SummaryEntry(date: .now, summary: .sample(), fresh: true, signedIn: true)
}

#Preview(as: .systemSmall) {
    TodayWidget()
} timeline: {
    SummaryEntry(date: .now, summary: .sample(), fresh: true, signedIn: true)
}
