package com.sikorokoro44.cloudopencode.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import java.util.Date

private val TABS = listOf("Home", "Chat", "Files", "GitHub", "Builds", "Tasks", "Images", "Settings")

@Composable
fun CloudOpenCodeApp(viewModel: CloudOpenCodeViewModel) {
    val state by viewModel.state.collectAsState()
    val colorScheme = when (state.themeMode) {
        "dark" -> darkColorScheme()
        "light" -> lightColorScheme()
        else -> if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
    }
    MaterialTheme(colorScheme = colorScheme) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            BackHandler(enabled = state.onboardingComplete && state.token != null &&
                (state.selectedTab != 0 || state.message != null)) {
                if (state.message != null) viewModel.dismissMessage() else viewModel.setTab(0)
            }
            when {
                !state.onboardingComplete -> OnboardingScreen(viewModel)
                state.token == null -> LoginScreen(viewModel, state)
                else -> MainScreen(viewModel, state)
            }
        }
    }
}

@Composable
private fun MessageBanner(state: CloudUiState, viewModel: CloudOpenCodeViewModel) {
    val message = state.message ?: return
    val color = when (message.severity) {
        MessageSeverity.Error -> MaterialTheme.colorScheme.error
        MessageSeverity.Success -> MaterialTheme.colorScheme.primary
        MessageSeverity.Info -> MaterialTheme.colorScheme.secondary
    }
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message.text, color = color, modifier = Modifier.weight(1f))
            if (state.canRetry) TextButton(onClick = { viewModel.retryLastAction() }) { Text("Retry") }
            TextButton(onClick = { viewModel.dismissMessage() }) { Text("Dismiss") }
        }
    }
}

@Composable
private fun EmptyText(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun OnboardingScreen(viewModel: CloudOpenCodeViewModel) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Cloud OpenCode", style = MaterialTheme.typography.headlineLarge)
        Text(
            "Chat with free AI models, generate an Android project, build it in the cloud and download an APK — all from your phone.",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(top = 12.dp),
        )
        EmptyText("• Connect GitHub to give every project its own public repository")
        EmptyText("• Builds run in GitHub Actions; no Android Studio needed on the device")
        EmptyText("• Debug APKs and signed releases are delivered by short-lived HTTPS links")
        Button(onClick = { viewModel.completeOnboarding() }, modifier = Modifier.padding(top = 24.dp)) {
            Text("Get started")
        }
    }
}

@Composable
private fun LoginScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Cloud OpenCode", style = MaterialTheme.typography.headlineMedium)
        Text("Sign in or create an account", modifier = Modifier.padding(top = 8.dp, bottom = 16.dp))
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            password, { password = it }, label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.login(email, password) }, modifier = Modifier.weight(1f)) { Text("Login") }
            Button(onClick = { viewModel.register(email, password) }, modifier = Modifier.weight(1f)) { Text("Register") }
        }
        MessageBanner(state, viewModel)
        if (state.loading) CircularProgressIndicator(Modifier.padding(top = 12.dp))
        TextButton(onClick = { viewModel.setThemeMode(if (state.themeMode == "dark") "light" else "dark") }) {
            Text(if (state.themeMode == "dark") "Use light theme" else "Use dark theme")
        }
    }
}

@Composable
private fun MainScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 700.dp
        if (wide) {
            Row(Modifier.fillMaxSize()) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .width(200.dp)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("Cloud OpenCode", style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { viewModel.logout() }) { Text("Logout") }
                    TABS.forEachIndexed { index, title ->
                        TextButton(onClick = { viewModel.setTab(index) }) {
                            Text(if (index == state.selectedTab) "▸ $title" else title)
                        }
                    }
                }
                Column(Modifier.fillMaxSize().weight(1f)) {
                    ScreenHeader(viewModel, state)
                    ScreenContent(viewModel, state)
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                ScreenHeader(viewModel, state)
                ScrollableTabRow(selectedTabIndex = state.selectedTab) {
                    TABS.forEachIndexed { index, title ->
                        Tab(selected = state.selectedTab == index, onClick = { viewModel.setTab(index) }, text = { Text(title) })
                    }
                }
                ScreenContent(viewModel, state)
            }
        }
    }
}

@Composable
private fun ScreenHeader(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Cloud OpenCode", style = MaterialTheme.typography.titleLarge)
        TextButton(onClick = { viewModel.logout() }) { Text("Logout") }
    }
    MessageBanner(state, viewModel)
    if (state.loading) LinearProgressIndicator(
        progress = 0.5f,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    )
}

@Composable
private fun ScreenContent(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    when (state.selectedTab) {
        0 -> HomeScreen(viewModel, state)
        1 -> ChatScreen(viewModel, state)
        2 -> FilesScreen(viewModel, state)
        3 -> GithubScreen(viewModel, state)
        4 -> BuildsScreen(viewModel, state)
        5 -> TasksScreen(viewModel, state)
        6 -> ImagesScreen(viewModel, state)
        else -> SettingsScreen(viewModel, state)
    }
}

@Composable
private fun HomeScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Dashboard", style = MaterialTheme.typography.titleLarge)
        state.email?.let { Text("Signed in as $it") }
        Text("GitHub: ${if (state.githubStatus?.connected == true) "connected as ${state.githubStatus?.login}" else "not connected"}")
        Text("Projects: ${state.selectedProjectName ?: "none selected"}")
        Text("Builds: ${state.builds.size}; tasks: ${state.tasks.size}")
        Text("Models available: ${state.models.size}")
        state.readiness?.let { readiness ->
            Text("Live AI configured: ${readiness.readyForLiveAiEditing}")
            Text("Live GitHub OAuth configured: ${readiness.readyForLiveOAuth}")
            if (readiness.blockers.isNotEmpty()) {
                Text("Configuration blockers:", style = MaterialTheme.typography.labelMedium)
                readiness.blockers.forEach { blocker -> EmptyText("• $blocker") }
            }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.refreshAll() }) { Text("Refresh status") }
            Button(onClick = { viewModel.setTab(1) }) { Text("Open chat") }
            Button(onClick = { viewModel.setTab(4) }) { Text("Builds") }
            Button(onClick = { viewModel.setTab(7) }) { Text("Settings") }
        }
    }
}

@Composable
private fun ChatScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    var sessionDraft by remember(state.chatSessionKey) { mutableStateOf(state.chatSessionKey) }
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        OutlinedTextField(sessionDraft, { sessionDraft = it }, label = { Text("Conversation") }, modifier = Modifier.fillMaxWidth())
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.switchChatSession(sessionDraft) }) { Text("Load conversation") }
            Button(onClick = { viewModel.newChat() }) { Text("New chat") }
            Button(onClick = { viewModel.refreshChatHistory() }) { Text("Refresh history") }
        }
        state.chatModel?.let { Text("Responding model: $it", style = MaterialTheme.typography.labelMedium) }
        if (state.chatAttempts.isNotEmpty()) {
            EmptyText("Fallback attempts: ${state.chatAttempts.joinToString(" → ")}")
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(vertical = 8.dp)) {
            if (state.chatMessages.isEmpty()) {
                item { EmptyText("No messages yet. Ask the assistant to create an Android app.") }
            }
            items(state.chatMessages) { message ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text(message.role, style = MaterialTheme.typography.labelMedium)
                        Text(message.content)
                        message.model?.let { Text("Model: $it", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(state.chatInput, viewModel::updateChatInput, label = { Text("Message") }, modifier = Modifier.weight(1f))
            Button(onClick = { viewModel.sendChat() }, enabled = !state.loading && state.chatInput.isNotBlank()) { Text("Send") }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.updateWebSearch(!state.webSearch) }) {
                Text(if (state.webSearch) "Web search: on" else "Web search: off")
            }
            Button(onClick = { viewModel.retryLastAction() }, enabled = state.canRetry) { Text("Retry last action") }
            if (state.loading) CircularProgressIndicator()
        }
        state.lastSearch?.let { search ->
            Text("Search provider: ${search.provider}", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            LazyColumn(Modifier.weight(0.3f)) {
                items(search.results) { result -> Text("${result.title}: ${result.url}", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun FilesScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Project: ${state.selectedProjectName ?: "none selected"}", style = MaterialTheme.typography.titleMedium)
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.refreshFiles() }) { Text("Refresh") }
            Button(onClick = { viewModel.commitProject() }) { Text("Commit") }
        }
        state.selectedFilePath?.let { Text("Editing: $it", style = MaterialTheme.typography.labelMedium) }
        LazyColumn(Modifier.weight(0.3f)) {
            if (state.files.isEmpty()) item { EmptyText("No project files yet. Select a repository on the GitHub tab.") }
            items(state.files) { file ->
                TextButton(onClick = { viewModel.selectFile(file.path) }) { Text(file.path + if (file.dirty) " *" else "") }
            }
        }
        OutlinedTextField(state.fileDraft, viewModel::updateFileDraft, label = { Text("File content") }, modifier = Modifier.fillMaxWidth().weight(0.35f))
        OutlinedTextField(state.aiInstruction, viewModel::updateAiInstruction, label = { Text("AI instruction") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.saveSelectedFile() }, enabled = state.selectedFilePath != null) { Text("Save") }
            Button(onClick = { viewModel.aiEditFiles() }, enabled = state.aiInstruction.isNotBlank()) { Text("AI edit") }
            Button(onClick = { viewModel.createBuildWorkflow() }) { Text("Add workflow") }
        }
        OutlinedTextField(state.commitMessage, viewModel::updateCommitMessage, label = { Text("Commit message") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        LazyColumn(Modifier.weight(0.2f)) {
            if (state.commits.isEmpty()) item { EmptyText("No commits yet.") }
            items(state.commits) { commit ->
                Text("${commit.id}: ${commit.status} ${commit.commitSha ?: ""} ${commit.error ?: ""}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun GithubScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("GitHub", style = MaterialTheme.typography.titleLarge)
        val status = state.githubStatus
        if (status == null) {
            EmptyText("GitHub status not loaded yet.")
        } else {
            Text("Configured: ${status.configured}; Connected: ${status.connected}")
            status.login?.let { Text("Login: $it") }
            status.scopes?.let { Text("Scopes: $it") }
            status.connectedAt?.let { Text("Connected at: ${Date(it)}") }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.openGithubOAuth() }) { Text("Connect GitHub") }
            Button(onClick = { viewModel.refreshGithub() }) { Text("Refresh") }
            Button(onClick = { viewModel.disconnectGithub() }, enabled = status?.connected == true) { Text("Disconnect") }
        }
        OutlinedTextField(state.repoNameInput, viewModel::updateRepoName, label = { Text("Repository name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(state.repoDescriptionInput, viewModel::updateRepoDescription, label = { Text("Description") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Button(onClick = { viewModel.createRepository() }, enabled = status?.connected == true && state.repoNameInput.isNotBlank()) {
            Text("Create repository")
        }
        LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
            if (state.repositories.isEmpty()) item { EmptyText("No repositories available. Connect GitHub and refresh.") }
            items(state.repositories) { repo ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text(repo.fullName, style = MaterialTheme.typography.titleMedium)
                        Text("Branch: ${repo.defaultBranch}; private: ${repo.isPrivate}")
                        Button(onClick = { viewModel.selectRepository(repo.fullName) }) { Text("Select") }
                    }
                }
            }
        }
    }
}

@Composable
private fun BuildsScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Builds", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(state.buildWorkflowPath, viewModel::updateBuildWorkflowPath, label = { Text("Workflow path") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(state.buildRef, viewModel::updateBuildRef, label = { Text("Ref") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.startBuild() }, enabled = state.selectedProjectName != null) { Text("Start build") }
            Button(onClick = { viewModel.refreshBuilds() }) { Text("Refresh") }
            Button(onClick = { viewModel.pollBuilds() }) { Text("Monitor") }
        }
        LazyColumn(Modifier.weight(0.35f)) {
            if (state.builds.isEmpty()) item { EmptyText("No builds yet. Select a project and start a build.") }
            items(state.builds) { build ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text("${build.id}: ${build.status} ${build.conclusion ?: ""}")
                        LinearProgressIndicator(
                            progress = build.progress.coerceIn(0, 100) / 100f,
                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                        )
                        Text("Progress: ${build.progress}%", style = MaterialTheme.typography.bodySmall)
                        build.error?.let { Text("Error: $it", color = MaterialTheme.colorScheme.error) }
                        if (state.selectedBuildId == build.id) {
                            Text("Selected for APK delivery", style = MaterialTheme.typography.bodySmall)
                        }
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(onClick = { viewModel.selectBuildForDelivery(build.id) }) { Text("APK") }
                            Button(onClick = { viewModel.refreshBuild(build.id) }) { Text("Refresh") }
                            Button(onClick = { viewModel.retryBuild(build.id) }) { Text("Retry") }
                            Button(onClick = { viewModel.loadBuildLogs(build.id) }) { Text("Logs") }
                        }
                    }
                }
            }
        }
        state.buildLogSummary?.failedSteps?.let { failed ->
            if (failed.isNotEmpty()) {
                Text("Failed steps: ${failed.joinToString { "${it.job} / ${it.step}" }}", color = MaterialTheme.colorScheme.error)
            }
        }
        OutlinedTextField(state.buildLogs, {}, label = { Text("Build logs") }, modifier = Modifier.fillMaxWidth().weight(0.2f), readOnly = true)
        Text("APK delivery", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        Text(
            state.selectedBuildId?.let { id ->
                state.builds.firstOrNull { it.id == id }?.let { build ->
                    "Build ${build.id}: ${build.status} ${build.conclusion ?: ""}"
                } ?: "Build $id selected"
            } ?: "No build selected",
            style = MaterialTheme.typography.bodyMedium,
        )
        state.apkDeliveryMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(state.apkArtifactIdInput, viewModel::updateApkArtifactId, label = { Text("Artifact ID") }, modifier = Modifier.width(160.dp))
            Button(onClick = { viewModel.refreshBuildArtifacts() }, enabled = state.selectedBuildId != null && !state.apkDeliveryLoading) { Text("Load artifacts") }
        }
        LazyColumn(Modifier.weight(0.15f)) {
            if (state.buildArtifacts.isEmpty()) item { EmptyText("No artifacts loaded.") }
            items(state.buildArtifacts) { artifact ->
                TextButton(onClick = { viewModel.selectArtifact(artifact.id) }, enabled = !artifact.expired) {
                    val selected = state.selectedArtifactId == artifact.id
                    Text("${if (selected) "✓ " else ""}${ApkDelivery.artifactStatus(artifact)}")
                }
            }
        }
        val chosenId = state.apkArtifactIdInput.toLongOrNull() ?: state.selectedArtifactId
        val chosenArtifact = state.buildArtifacts.firstOrNull { it.id == chosenId }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.createApkDownloadLink() }, enabled = !state.apkDeliveryLoading && chosenArtifact?.expired == false) { Text("Create download link") }
            Button(onClick = { viewModel.loadApkChecksum() }, enabled = !state.apkDeliveryLoading && chosenArtifact?.expired == false) { Text("Load checksum") }
            Button(onClick = { viewModel.openApkDownload() }, enabled = state.apkDownloadUrl != null) { Text("Download APK") }
        }
        state.apkDownloadUrl?.let { url -> Text("Download URL: $url", style = MaterialTheme.typography.bodySmall) }
        state.apkDownloadExpiresAt?.let { expires -> Text("Link expires at: ${Date(expires)}", style = MaterialTheme.typography.bodySmall) }
        state.apkChecksum?.let { checksum ->
            Text("File: ${checksum.filename}", style = MaterialTheme.typography.bodySmall)
            Text("Size: ${ApkDelivery.formatFileSize(checksum.sizeInBytes)} (${checksum.sizeInBytes} bytes)", style = MaterialTheme.typography.bodySmall)
            Text("SHA-256: ${checksum.sha256}", style = MaterialTheme.typography.bodySmall)
        }
        if (state.apkDeliveryLoading) CircularProgressIndicator(Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun TasksScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Cloud tasks", style = MaterialTheme.typography.titleLarge)
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(state.newTaskDescription, viewModel::updateTaskDescription, label = { Text("Description") }, modifier = Modifier.weight(1f))
            Button(onClick = { viewModel.createTask() }, enabled = state.newTaskDescription.isNotBlank()) { Text("Create") }
        }
        LazyColumn(Modifier.weight(1f)) {
            if (state.tasks.isEmpty()) item { EmptyText("No tasks yet.") }
            items(state.tasks) { task ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text("${task.id}: ${task.status}")
                        Text(task.description)
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(onClick = { viewModel.updateTask(task.id, "running") }) { Text("Run") }
                            Button(onClick = { viewModel.updateTask(task.id, "succeeded") }) { Text("Done") }
                            Button(onClick = { viewModel.cancelTask(task.id) }) { Text("Cancel") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ImagesScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Images", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(state.imagePrompt, viewModel::updateImagePrompt, label = { Text("Prompt") }, modifier = Modifier.fillMaxWidth())
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.generateImage() }, enabled = state.imagePrompt.isNotBlank()) { Text("Generate") }
            Button(onClick = { viewModel.refreshImages() }) { Text("Refresh") }
        }
        LazyColumn(Modifier.weight(1f)) {
            if (state.images.isEmpty()) item { EmptyText("No generated images yet.") }
            items(state.images) { image ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text("${image.id}: ${image.source} ${image.mimeType} ${image.sizeBytes} bytes")
                        image.prompt?.let { EmptyText(it) }
                        TextButton(onClick = { viewModel.openImage(image.id) }) { Text("Open") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)
        Text("Theme", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("system", "light", "dark").forEach { mode ->
                Button(onClick = { viewModel.setThemeMode(mode) }, enabled = state.themeMode != mode) {
                    Text(mode.replaceFirstChar { it.uppercase() })
                }
            }
        }
        Text("Conversation: ${state.chatSessionKey}", modifier = Modifier.padding(top = 12.dp))
        Button(onClick = { viewModel.newChat() }) { Text("Start a new conversation") }
        Button(onClick = { viewModel.updateWebSearch(!state.webSearch) }) {
            Text(if (state.webSearch) "Web search: on" else "Web search: off")
        }
        Text("Backend: ${state.backendBaseUrl.ifBlank { "not configured" }}", modifier = Modifier.padding(top = 12.dp))
        Text("Fallback chain (in order):", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp))
        if (state.models.isEmpty()) {
            EmptyText("Model list not loaded yet.")
        } else {
            state.models.forEachIndexed { index, model -> EmptyText("${index + 1}. $model") }
        }
        state.readiness?.let { readiness ->
            Text("Readiness", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            Text("Live AI: ${readiness.readyForLiveAiEditing}; OAuth: ${readiness.readyForLiveOAuth}; builds: ${readiness.readyForLiveBuilds}")
            readiness.manualChecks.forEach { check -> EmptyText("• $check") }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { viewModel.refreshAll() }) { Text("Refresh status") }
            Button(onClick = { viewModel.retryLastAction() }, enabled = state.canRetry) { Text("Retry") }
            Button(onClick = { viewModel.clearMessage() }) { Text("Clear message") }
        }
    }
}
