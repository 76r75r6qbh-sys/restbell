import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents
import RestbellKit

/// The session on the Lock Screen and in the Dynamic Island, with buttons to log the set or handle rest.
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutAttributes.self) { context in
            LockScreenWorkoutView(context: context)
                .padding(16)
                .activityBackgroundTint(Color.black.opacity(0.35))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(DeepLink.session)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(state.setLabel).font(.caption.weight(.semibold))
                    } icon: {
                        Image(systemName: context.attributes.dayType == "run" ? "figure.run" : "figure.strengthtraining.traditional")
                    }
                    .foregroundStyle(Color.accentColor)
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let range = state.restRange {
                        Text(timerInterval: range, countsDown: true)
                            .font(.title3.weight(.semibold)).numeric()
                            .multilineTextAlignment(.trailing)
                            .frame(width: 64)
                    } else {
                        Text("\(state.setsDone)/\(state.setsTotal)").font(.title3.weight(.semibold)).numeric()
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(state.exerciseName).font(.headline).lineLimit(1)
                        if !state.target.isEmpty { Text(state.target).font(.subheadline).foregroundStyle(.secondary).numeric() }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    WorkoutButtons(state: state).padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: context.attributes.dayType == "run" ? "figure.run" : "dumbbell.fill")
                    .foregroundStyle(Color.accentColor)
            } compactTrailing: {
                if let range = state.restRange {
                    Text(timerInterval: range, countsDown: true)
                        .numeric()
                        .frame(maxWidth: 44)
                        .foregroundStyle(Color.accentColor)
                } else if state.phase == .running {
                    Text(context.attributes.startedAt, style: .timer).numeric().frame(maxWidth: 52)
                } else {
                    Text("\(state.setsDone)/\(state.setsTotal)").numeric()
                }
            } minimal: {
                if let range = state.restRange {
                    ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { Image(systemName: "timer") }
                        .progressViewStyle(.circular)
                        .tint(Color.accentColor)
                } else {
                    Image(systemName: "dumbbell.fill").foregroundStyle(Color.accentColor)
                }
            }
            .keylineTint(Color.accentColor)
            .widgetURL(DeepLink.session)
        }
    }
}

struct LockScreenWorkoutView: View {
    let context: ActivityViewContext<WorkoutAttributes>

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    ProgressRing(progress: state.progress, color: .accentColor, lineWidth: 5)
                    Image(systemName: context.attributes.dayType == "run" ? "figure.run" : "dumbbell.fill").font(.caption)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(state.phase == .resting ? "Rest · next up" : state.setLabel).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(state.exerciseName).font(.headline).lineLimit(1)
                    if !state.target.isEmpty { Text(state.target).font(.subheadline).numeric() }
                }
                Spacer()
                if let range = state.restRange {
                    Text(timerInterval: range, countsDown: true)
                        .font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 96)
                } else if state.phase == .running {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 110)
                } else {
                    Text("\(state.setsDone)/\(state.setsTotal)").font(.title2.weight(.semibold)).numeric()
                }
            }
            if state.phase != .running && state.phase != .done {
                WorkoutButtons(state: state)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

struct WorkoutButtons: View {
    let state: WorkoutAttributes.ContentState

    var body: some View {
        HStack(spacing: 8) {
            if state.phase == .resting {
                Button(intent: AddRestIntent()) {
                    Label("30 s", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .tint(.gray)
                Button(intent: SkipRestIntent()) {
                    Label("Skip", systemImage: "forward.fill").frame(maxWidth: .infinity)
                }
                .tint(.accentColor)
            } else {
                Button(intent: LogPrescribedSetIntent()) {
                    Label("Log \(state.target.isEmpty ? "set" : state.target)", systemImage: "checkmark").lineLimit(1).frame(maxWidth: .infinity)
                }
                .tint(.accentColor)
            }
        }
        .buttonStyle(.borderedProminent)
        .font(.subheadline.weight(.semibold))
    }
}

#Preview("Lock Screen", as: .content, using: WorkoutAttributes(title: "Lift A · full body", dayType: "lift", startedAt: .now)) {
    WorkoutLiveActivity()
} contentStates: {
    WorkoutAttributes.ContentState(exerciseName: "Bench press", setLabel: "Set 2 of 3", target: "8 × 52.5 kg", phase: .lifting, restEndsAt: nil, restStartedAt: nil, setsDone: 4, setsTotal: 11, next: nil)
    WorkoutAttributes.ContentState(exerciseName: "Bench press", setLabel: "Set 3 of 3", target: "8 × 52.5 kg", phase: .resting, restEndsAt: .now.addingTimeInterval(95), restStartedAt: .now.addingTimeInterval(-25), setsDone: 5, setsTotal: 11, next: nil)
}
