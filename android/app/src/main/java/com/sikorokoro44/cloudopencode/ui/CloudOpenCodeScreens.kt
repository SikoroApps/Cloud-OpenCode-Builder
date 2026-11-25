package com.sikorokoro44.cloudopencode.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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

@Composable
fun CloudOpenCodeApp(viewModel: CloudOpenCodeViewModel) {
    val state by viewModel.state.collectAsState()
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (state.token == null) LoginScreen(viewModel, state) else MainScreen(viewModel, state)
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
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.login(email, password) }, modifier = Modifier.weight(1f)) { Text("Login") }
            Button(onClick = { viewModel.register(email, password) }, modifier = Modifier.weight(1f)) { Text("Register") }
        }
        state.message?.let { Text(it, modifier = Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.primary) }
        if (state.loading) CircularProgressIndicator(Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun MainScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Chat", "Files", "GitHub", "Builds", "Tasks", "Images")
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Cloud OpenCode", style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = { viewModel.logout() }) { Text("Logout") }
        }
        state.message?.let { Text(it, modifier = Modifier.padding(horizontal = 12.dp), color = MaterialTheme.colorScheme.primary) }
        TabRow(selectedTabIndex = selectedTab) {
            tabs.forEachIndexed { index, title ->
                Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(title) })
            }
        }
        when (selectedTab) {
            0 -> ChatScreen(viewModel, state)
            1 -> FilesScreen(viewModel, state)
            2 -> GithubScreen(viewModel, state)
            3 -> BuildsScreen(viewModel, state)
            4 -> TasksScreen(viewModel, state)
            else -> ImagesScreen(viewModel, state)
        }
    }
}

@Composable
private fun ChatScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        OutlinedTextField(state.chatSessionKey, viewModel::updateChatSession, label = { Text("Session key") }, modifier = Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(vertical = 8.dp)) {
            items(state.chatMessages) { message ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text(message.role, style = MaterialTheme.typography.labelMedium)
                        Text(message.content)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(state.chatInput, viewModel::updateChatInput, label = { Text("Message") }, modifier = Modifier.weight(1f))
            Button(onClick = { viewModel.sendChat() }, enabled = !state.loading) { Text("Send") }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.updateWebSearch(!state.webSearch) }) { Text(if (state.webSearch) "Web search: on" else "Web search: off") }
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
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.refreshFiles() }) { Text("Refresh") }
            Button(onClick = { viewModel.commitProject() }) { Text("Commit") }
        }
        LazyColumn(Modifier.weight(0.35f)) {
            items(state.files) { file ->
                TextButton(onClick = { viewModel.selectFile(file.path) }) { Text(file.path + if (file.dirty) " *" else "") }
            }
        }
        OutlinedTextField(state.fileDraft, viewModel::updateFileDraft, label = { Text("File content") }, modifier = Modifier.fillMaxWidth().weight(0.45f))
        OutlinedTextField(state.aiInstruction, viewModel::updateAiInstruction, label = { Text("AI instruction") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.saveSelectedFile() }) { Text("Save") }
            Button(onClick = { viewModel.aiEditFiles() }) { Text("AI edit") }
            Button(onClick = { viewModel.createBuildWorkflow() }) { Text("Add workflow") }
        }
        OutlinedTextField(state.commitMessage, viewModel::updateCommitMessage, label = { Text("Commit message") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
    }
}

@Composable
private fun GithubScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("GitHub", style = MaterialTheme.typography.titleLarge)
        state.githubStatus?.let { status ->
            Text("Configured: ${status.configured}; Connected: ${status.connected}")
            status.login?.let { Text("Login: $it") }
            status.scopes?.let { Text("Scopes: $it") }
        }
        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.openGithubOAuth() }) { Text("Connect GitHub") }
            Button(onClick = { viewModel.refreshGithub() }) { Text("Refresh") }
            Button(onClick = { viewModel.disconnectGithub() }) { Text("Disconnect") }
        }
        OutlinedTextField(state.repoNameInput, viewModel::updateRepoName, label = { Text("Repository name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(state.repoDescriptionInput, viewModel::updateRepoDescription, label = { Text("Description") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Button(onClick = { viewModel.createRepository() }, modifier = Modifier.padding(top = 8.dp)) { Text("Create repository") }
        LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
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
        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.startBuild() }) { Text("Start build") }
            Button(onClick = { viewModel.refreshBuilds() }) { Text("Refresh") }
        }
        LazyColumn(Modifier.weight(0.45f)) {
            items(state.builds) { build ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text("${build.id}: ${build.status} ${build.conclusion ?: ""}")
                        Text("Progress: ${build.progress}%")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { viewModel.refreshBuild(build.id) }) { Text("Refresh") }
                            Button(onClick = { viewModel.loadBuildLogs(build.id) }) { Text("Logs") }
                        }
                    }
                }
            }
        }
        OutlinedTextField(state.buildLogs, {}, label = { Text("Build logs") }, modifier = Modifier.fillMaxWidth().weight(0.4f), readOnly = true)
    }
}

@Composable
private fun TasksScreen(viewModel: CloudOpenCodeViewModel, state: CloudUiState) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Cloud tasks", style = MaterialTheme.typography.titleLarge)
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(state.newTaskDescription, viewModel::updateTaskDescription, label = { Text("Description") }, modifier = Modifier.weight(1f))
            Button(onClick = { viewModel.createTask() }) { Text("Create") }
        }
        LazyColumn(Modifier.weight(1f)) {
            items(state.tasks) { task ->
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(8.dp)) {
                        Text("${task.id}: ${task.status}")
                        Text(task.description)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.generateImage() }) { Text("Generate") }
            Button(onClick = { viewModel.refreshImages() }) { Text("Refresh") }
        }
        LazyColumn(Modifier.weight(1f)) {
            items(state.images) { image -> Text("${image.id}: ${image.source} ${image.mimeType} ${image.sizeBytes} bytes") }
        }
    }
}
