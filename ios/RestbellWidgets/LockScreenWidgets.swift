import SwiftUI
import WidgetKit
import RestbellKit

/// Lock Screen: protein so far as a gauge.
struct ProteinWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Protein", provider: SummaryProvider()) { entry in
            let f = entry.summary.food
            Gauge(value: min(f.proteinG, f.targets.proteinG), in: 0...max(f.targets.proteinG, 1)) {
                Image(systemName: "fork.knife")
            } currentValueLabel: {
                Text("\(Int(f.proteinG))").numeric()
            }
            .gaugeStyle(.accessoryCircular)
            .widgetURL(DeepLink.food)
            .containerBackground(.clear, for: .widget)
            .accessibilityLabel("Protein \(Int(f.proteinG)) of \(Int(f.targets.proteinG)) grams")
        }
        .configurationDisplayName("Protein")
        .description("Protein eaten today against your target.")
        .supportedFamilies([.accessoryCircular])
    }
}

/// Lock Screen: today's session, or what's left of the week.
struct NextSessionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextSession", provider: SummaryProvider()) { entry in
            NextSessionView(summary: entry.summary)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Today's session")
        .description("What's planned today and how the week is going.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct NextSessionView: View {
    var summary: Summary
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let s = summary.session
        if family == .accessoryInline {
            Label(s.status == "rest" ? "Rest day · week \(summary.week.done)/\(summary.week.planned)" : "\(s.title ?? "Session")\(s.time.map { " · \($0)" } ?? "")",
                  systemImage: "figure.strengthtraining.traditional")
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Label(s.status == "done" ? "Done today" : s.status == "active" ? "In progress" : s.status == "rest" ? "Rest day" : (s.time ?? "Today"),
                      systemImage: s.type == "run" ? "figure.run" : "figure.strengthtraining.traditional")
                    .font(.caption.weight(.semibold))
                    .widgetAccentable()
                Text(s.title ?? "Recover well").font(.headline).lineLimit(1)
                Text("\(Int(summary.food.proteinG)) g protein · week \(summary.week.done)/\(summary.week.planned)").font(.caption).numeric()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(s.status == "rest" ? DeepLink.today : DeepLink.session)
        }
    }
}

/// Lock Screen: recovery score from HRV, resting HR and sleep.
struct RecoveryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Recovery", provider: SummaryProvider()) { entry in
            Group {
                if let r = entry.summary.recovery {
                    Gauge(value: Double(r.score), in: 0...100) {
                        Image(systemName: "heart.fill")
                    } currentValueLabel: {
                        Text("\(r.score)").numeric()
                    }
                    .gaugeStyle(.accessoryCircular)
                    .accessibilityLabel("Recovery \(r.score), \(r.level)")
                } else {
                    Image(systemName: "heart.slash").font(.title2).accessibilityLabel("No recovery data yet")
                }
            }
            .widgetURL(DeepLink.today)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Recovery")
        .description("Today's recovery from your Apple Watch: HRV, resting heart rate and sleep.")
        .supportedFamilies([.accessoryCircular])
    }
}
