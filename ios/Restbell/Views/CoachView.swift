import SwiftUI
import RestbellKit
import UserNotifications

struct CoachView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Group {
                switch model.coachSection {
                case .chat: ChatView()
                case .notes: NotesView()
                }
            }
            .navigationTitle("Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Section", selection: $model.coachSection) {
                        Text("Chat").tag(AppModel.CoachSection.chat)
                        Text("Weekly Notes").tag(AppModel.CoachSection.notes)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 240)
                }
            }
        }
    }
}

struct ChatView: View {
    @Environment(AppModel.self) private var model
    @State private var messages: [ChatMessage] = []
    @State private var pending = false
    @State private var enabled = true
    @State private var draft = ""
    @State private var loaded = false
    @FocusState private var composing: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if loaded && messages.isEmpty {
                        ContentUnavailableView("Ask your coach", systemImage: "bubble.left.and.text.bubble.right",
                                               description: Text("Questions about training, food or recovery. The coach sees your logs and Watch data."))
                            .padding(.top, 60)
                    }
                    ForEach(messages) { m in
                        Bubble(message: m).id(m.id)
                    }
                    if pending {
                        TypingBubble().id("typing")
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: messages.count) { scrollToEnd(proxy) }
            .onChange(of: pending) { scrollToEnd(proxy) }
            .safeAreaInset(edge: .bottom) { composer }
        }
        .groupedBackground()
        .task { await load() }
        .task(id: pending) { await poll() }
    }

    var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(enabled ? "Message your coach" : "The coach is off on the server", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused($composing)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .glassBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous), interactive: true)
                .disabled(!enabled)
            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.headline.weight(.bold))
                    .frame(width: 30, height: 30)
            }
            .prominentButton()
            .buttonBorderShape(.circle)
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !enabled)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    func scrollToEnd(_ proxy: ScrollViewProxy) {
        withAnimation(.snappy) {
            if pending { proxy.scrollTo("typing", anchor: .bottom) } else if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
    }

    func load() async {
        guard let api = model.api, let page = try? await api.chat() else { return }
        messages = page.messages
        pending = page.pending
        enabled = page.enabled
        loaded = true
        await markRead()
    }

    func markRead() async {
        guard let r = try? await model.api?.markChatRead() else { return }
        try? await UNUserNotificationCenter.current().setBadgeCount(r.unread)
        model.summary?.unreadChat = r.unread
    }

    /// While the coach writes, ask for new messages every 1.5 s.
    func poll() async {
        while pending, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(1500))
            guard let api = model.api, let page = try? await api.chat(after: messages.last?.id ?? 0) else { continue }
            messages.append(contentsOf: page.messages.filter { m in !messages.contains { $0.id == m.id } })
            pending = page.pending
        }
        await markRead()
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let api = model.api else { return }
        draft = ""
        do {
            let sent = try await api.sendChat(text)
            messages.append(sent.message)
            pending = sent.pending
        } catch {
            draft = text
            model.flash(error.localizedDescription)
        }
    }
}

struct Bubble: View {
    var message: ChatMessage

    var body: some View {
        HStack {
            if message.isMine { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: 4) {
                if let kind {
                    Label(kind.0, systemImage: kind.1)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Text(message.text)
                    .foregroundStyle(message.isMine ? Color.white : Color.primary)
                    .textSelection(.enabled)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(message.isMine ? AnyShapeStyle(Color.accentColor.gradient) : AnyShapeStyle(Color(.secondarySystemGroupedBackground)),
                        in: .rect(cornerRadius: 20, style: .continuous))
            .opacity(message.kind == "error" ? 0.7 : 1)
            if !message.isMine { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message.isMine ? "You" : "Coach")
        .accessibilityValue(message.text)
    }

    var kind: (String, String)? {
        switch message.kind {
        case "review": ("Weekly review", "calendar")
        case "debrief": ("Session debrief", "figure.strengthtraining.traditional")
        case "error": ("Not delivered", "exclamationmark.triangle")
        default: nil
        }
    }
}

struct TypingBubble: View {
    @State private var phase = false
    var body: some View {
        HStack {
            HStack(spacing: 5) {
                ForEach(0..<3) { i in
                    Circle().fill(.secondary).frame(width: 7, height: 7)
                        .opacity(phase ? 1 : 0.3)
                        .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.15), value: phase)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
            Spacer()
        }
        .onAppear { phase = true }
        .accessibilityLabel("Coach is typing")
    }
}

struct NotesView: View {
    @Environment(AppModel.self) private var model
    @State private var page: CoachPage?
    @State private var reviewing = false
    @State private var applied = 0

    var body: some View {
        List {
            if let page {
                if !page.proposals.isEmpty {
                    Section {
                        ForEach(page.proposals) { p in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(p.text).font(.headline)
                                if let reason = p.proposal.reason { Text(reason).font(.subheadline).foregroundStyle(.secondary) }
                                HStack {
                                    Button("Apply") { Task { await resolve(p, apply: true) } }.prominentButton()
                                    Button("Dismiss") { Task { await resolve(p, apply: false) } }.buttonStyle(.bordered)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    } header: {
                        Text("Proposed changes")
                    } footer: {
                        Text("Nothing changes until you apply it.")
                    }
                }
                ForEach(page.notes) { n in
                    Section("Week of \(Fmt.day(n.weekStart, style: .dateTime.day().month(.wide)))") {
                        Text(n.text).font(.callout).textSelection(.enabled).padding(.vertical, 4)
                    }
                }
                if page.notes.isEmpty {
                    ContentUnavailableView("No notes yet", systemImage: "note.text", description: Text("Every Sunday evening the coach reads the week and writes a note here."))
                }
                Section {
                    Button {
                        Task { await review() }
                    } label: {
                        HStack {
                            Label("Review This Week Now", systemImage: "sparkles")
                            Spacer()
                            if reviewing { ProgressView() }
                        }
                    }
                    .disabled(!page.enabled || reviewing)
                } footer: {
                    Text(reviewing ? "This takes about a minute." : "Weights are progressed by the app's rules; the note comments on trends.")
                }
            }
        }
        .overlay { if page == nil { ProgressView() } }
        .sensoryFeedback(.success, trigger: applied)
        .refreshable { await load() }
        .task { await load() }
    }

    func load() async { page = try? await model.api?.coach() }

    func resolve(_ p: Proposal, apply: Bool) async {
        do {
            _ = try await model.api?.resolveProposal(id: p.id, apply: apply)
            if apply { applied += 1 }
            model.flash(apply ? "Applied" : "Dismissed")
            await load()
            await model.refresh()
        } catch { model.flash(error.localizedDescription) }
    }

    func review() async {
        reviewing = true
        defer { reviewing = false }
        do {
            _ = try await model.api?.reviewNow()
            await load()
        } catch { model.flash(error.localizedDescription) }
    }
}
