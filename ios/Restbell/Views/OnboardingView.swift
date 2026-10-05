import SwiftUI
import RestbellKit

/// Server address and password, then Apple Health and notifications.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var server = SharedStore.serverURL?.absoluteString ?? ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focus: Field?
    enum Field { case server, password }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Image("Mark")
                            .resizable().scaledToFit().frame(width: 84, height: 84)
                            .clipShape(.rect(cornerRadius: 19, style: .continuous))
                            .accessibilityHidden(true)
                        Text("Restbell").font(.largeTitle.bold())
                        Text("Your training, food and coach, with Apple Watch data on your own server.")
                            .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("trainer.example.com", text: $server)
                        .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focus, equals: .server).submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("Password", text: $password)
                        .textContentType(.password).focused($focus, equals: .password).submitLabel(.go)
                        .onSubmit { Task { await signIn() } }
                } header: {
                    Text("Server")
                } footer: {
                    Text("The address you open Restbell at in Safari. Leave the password empty if the server has none.")
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await signIn() }
                    } label: {
                        HStack {
                            Spacer()
                            if working { ProgressView() } else { Text("Sign In").bold() }
                            Spacer()
                        }
                    }
                    .disabled(server.isEmpty || working)
                    Button("Try with demo data") { Task { await model.startDemo() } }
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Welcome")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    func signIn() async {
        working = true
        error = nil
        defer { working = false }
        do {
            try await model.signIn(server: server, password: password)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
