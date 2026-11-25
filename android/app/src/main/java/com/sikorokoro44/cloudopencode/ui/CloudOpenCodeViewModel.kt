package com.sikorokoro44.cloudopencode.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sikorokoro44.cloudopencode.data.network.CloudApiClient
import com.sikorokoro44.cloudopencode.data.network.CloudChatResponse
import com.sikorokoro44.cloudopencode.data.network.CloudImage
import com.sikorokoro44.cloudopencode.data.network.CloudTask
import com.sikorokoro44.cloudopencode.data.network.GithubRepository
import com.sikorokoro44.cloudopencode.data.network.GithubStatus
import com.sikorokoro44.cloudopencode.data.network.ProjectBuild
import com.sikorokoro44.cloudopencode.data.network.ProjectCommit
import com.sikorokoro44.cloudopencode.data.network.ProjectFile
import com.sikorokoro44.cloudopencode.data.network.ApkChecksum
import com.sikorokoro44.cloudopencode.data.network.ApkDownloadLink
import com.sikorokoro44.cloudopencode.data.network.BuildArtifact
import com.sikorokoro44.cloudopencode.data.network.WebSearchResponse
import com.sikorokoro44.cloudopencode.security.EncryptedTokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChatMessageUi(val role: String, val content: String)

data class CloudUiState(
    val token: String? = null,
    val email: String? = null,
    val loading: Boolean = false,
    val message: String? = null,
    val chatSessionKey: String = "default",
    val chatInput: String = "",
    val chatMessages: List<ChatMessageUi> = emptyList(),
    val webSearch: Boolean = false,
    val lastSearch: WebSearchResponse? = null,
    val githubStatus: GithubStatus? = null,
    val repositories: List<GithubRepository> = emptyList(),
    val selectedProjectName: String? = null,
    val repoNameInput: String = "",
    val repoDescriptionInput: String = "",
    val files: List<ProjectFile> = emptyList(),
    val selectedFilePath: String? = null,
    val fileDraft: String = "",
    val aiInstruction: String = "",
    val commitMessage: String = "Update project files",
    val commits: List<ProjectCommit> = emptyList(),
    val builds: List<ProjectBuild> = emptyList(),
    val buildWorkflowPath: String = ".github/workflows/android-build.yml",
    val buildRef: String = "main",
    val buildLogs: String = "",
    val buildArtifacts: List<BuildArtifact> = emptyList(),
    val selectedBuildId: String? = null,
    val selectedArtifactId: Long? = null,
    val apkArtifactIdInput: String = "",
    val apkDownloadUrl: String? = null,
    val apkDownloadExpiresAt: Long? = null,
    val apkChecksum: ApkChecksum? = null,
    val apkDeliveryLoading: Boolean = false,
    val apkDeliveryMessage: String? = null,
    val tasks: List<CloudTask> = emptyList(),
    val newTaskDescription: String = "",
    val images: List<CloudImage> = emptyList(),
    val imagePrompt: String = "",
)

class CloudOpenCodeViewModel(
    private val client: CloudApiClient,
    private val tokenStore: EncryptedTokenStore,
    private val context: Context,
) : ViewModel() {
    private val _state = MutableStateFlow(CloudUiState())
    val state: StateFlow<CloudUiState> = _state.asStateFlow()

    init {
        val stored = tokenStore.load()
        if (!stored.isNullOrBlank()) {
            _state.update { it.copy(token = stored) }
            refreshAll(stored)
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null) }
    fun updateChatInput(value: String) = _state.update { it.copy(chatInput = value) }
    fun updateChatSession(value: String) = _state.update { it.copy(chatSessionKey = value) }
    fun updateWebSearch(value: Boolean) = _state.update { it.copy(webSearch = value) }
    fun updateRepoName(value: String) = _state.update { it.copy(repoNameInput = value) }
    fun updateRepoDescription(value: String) = _state.update { it.copy(repoDescriptionInput = value) }
    fun updateFileDraft(value: String) = _state.update { it.copy(fileDraft = value) }
    fun updateAiInstruction(value: String) = _state.update { it.copy(aiInstruction = value) }
    fun updateCommitMessage(value: String) = _state.update { it.copy(commitMessage = value) }
    fun updateBuildWorkflowPath(value: String) = _state.update { it.copy(buildWorkflowPath = value) }
    fun updateBuildRef(value: String) = _state.update { it.copy(buildRef = value) }
    fun updateTaskDescription(value: String) = _state.update { it.copy(newTaskDescription = value) }
    fun updateImagePrompt(value: String) = _state.update { it.copy(imagePrompt = value) }

    fun register(email: String, password: String) = authenticate(email, password, true)
    fun login(email: String, password: String) = authenticate(email, password, false)

    private fun authenticate(email: String, password: String, register: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            val result = if (register) client.register(email, password) else client.login(email, password)
            result.onSuccess { token ->
                tokenStore.save(token.token)
                _state.update { it.copy(token = token.token, email = email, loading = false, message = "Authenticated") }
                refreshAll(token.token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Authentication failed") }
            }
        }
    }

    fun logout() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.logout(token)
            tokenStore.clear()
            _state.value = CloudUiState(message = "Logged out")
        }
    }

    fun refreshAll(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.history(token, _state.value.chatSessionKey).onSuccess { history ->
                _state.update { it.copy(chatMessages = history.map { msg -> ChatMessageUi(msg.role, msg.content) }) }
            }
            refreshGithub(token)
            refreshFiles(token)
            refreshBuilds(token)
            refreshTasks(token)
            refreshImages(token)
            _state.update { it.copy(loading = false) }
        }
    }

    fun sendChat() {
        val token = _state.value.token ?: return
        val content = _state.value.chatInput.trim()
        if (content.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            client.sendChat(token, _state.value.chatSessionKey, content, _state.value.webSearch).onSuccess { response: CloudChatResponse ->
                val messages = _state.value.chatMessages.toMutableList()
                response.userMessage?.let { messages.add(ChatMessageUi(it.role, it.content)) }
                response.assistantMessage?.let { messages.add(ChatMessageUi(it.role, it.content)) }
                _state.update {
                    it.copy(
                        chatMessages = messages,
                        chatInput = "",
                        lastSearch = response.webSearch?.let { search ->
                            WebSearchResponse(search.query, search.provider, search.results)
                        },
                        loading = false,
                    )
                }
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Chat failed") }
            }
        }
    }

    fun refreshGithub(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.githubStatus(token).onSuccess { status -> _state.update { it.copy(githubStatus = status) } }
            client.githubRepositories(token).onSuccess { repos -> _state.update { it.copy(repositories = repos) } }
            client.selectedGithubProject(token).onSuccess { project -> _state.update { it.copy(selectedProjectName = project?.repoFullName) } }
        }
    }

    fun startGithubOAuth() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.githubOAuthStart(token).onSuccess { oauth ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(oauth.authorizationUrl)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                context.startActivity(intent)
                _state.update { it.copy(message = "Complete GitHub authorization in the browser, then refresh status.") }
            }.onFailure {
                _state.update { it.copy(message = "Unable to start GitHub OAuth") }
            }
        }
    }

    fun createRepository() {
        val token = _state.value.token ?: return
        val state = _state.value
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.createGithubRepository(token, state.repoNameInput, state.repoDescriptionInput).onSuccess { repo ->
                _state.update { it.copy(loading = false, message = "Repository created: ${repo.fullName}") }
                refreshGithub(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Repository creation failed") }
            }
        }
    }

    fun selectRepository(fullName: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.selectGithubProject(token, fullName).onSuccess { project ->
                _state.update { it.copy(selectedProjectName = project.repoFullName, loading = false, message = "Selected ${project.repoFullName}") }
                refreshFiles(token)
                refreshBuilds(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Project selection failed") }
            }
        }
    }

    fun disconnectGithub() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.githubDisconnect(token)
            refreshGithub(token)
            _state.update { it.copy(message = "GitHub disconnected") }
        }
    }

    fun refreshFiles(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.projectFiles(token).onSuccess { files -> _state.update { it.copy(files = files) } }
        }
    }

    fun selectFile(path: String) {
        val file = _state.value.files.firstOrNull { it.path == path } ?: return
        _state.update { it.copy(selectedFilePath = path, fileDraft = file.content) }
    }

    fun saveSelectedFile() {
        val token = _state.value.token ?: return
        val path = _state.value.selectedFilePath ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.saveProjectFile(token, path, _state.value.fileDraft).onSuccess { file ->
                _state.update { it.copy(loading = false, message = "Saved ${file.path}") }
                refreshFiles(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "File save failed") }
            }
        }
    }

    fun aiEditFiles() {
        val token = _state.value.token ?: return
        val instruction = _state.value.aiInstruction.trim()
        if (instruction.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.aiEditFiles(token, instruction).onSuccess { result ->
                _state.update { it.copy(loading = false, message = "AI edited ${result.applied.size} file(s) with ${result.model}") }
                refreshFiles(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "AI file edit failed") }
            }
        }
    }

    fun commitProject() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.commitProject(token, _state.value.commitMessage).onSuccess { result ->
                _state.update { it.copy(loading = false, message = "Commit ${result.commitId}: ${result.status}") }
                refreshFiles(token)
                refreshCommits(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Commit failed") }
            }
        }
    }

    fun refreshCommits(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.projectCommits(token).onSuccess { commits -> _state.update { it.copy(commits = commits) } }
        }
    }

    fun createBuildWorkflow() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.createBuildWorkflow(token).onSuccess {
                _state.update { it.copy(message = "Build workflow saved") }
                refreshFiles(token)
            }.onFailure {
                _state.update { it.copy(message = "Build workflow creation failed") }
            }
        }
    }

    fun startBuild() {
        val token = _state.value.token ?: return
        val state = _state.value
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.startBuild(token, state.buildWorkflowPath, state.buildRef).onSuccess { build ->
                _state.update { it.copy(loading = false, message = "Build started: ${build.id}") }
                refreshBuilds(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Build start failed") }
            }
        }
    }

    fun refreshBuilds(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.builds(token).onSuccess { builds -> _state.update { it.copy(builds = builds) } }
        }
    }

    fun refreshBuild(buildId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.refreshBuild(token, buildId).onSuccess { build ->
                _state.update { it.copy(message = "Build ${build.id}: ${build.status} ${build.conclusion ?: ""}") }
                refreshBuilds(token)
            }
        }
    }

    fun loadBuildLogs(buildId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.buildLogs(token, buildId).onSuccess { logs ->
                val text = logs.jobs.joinToString("\n") { job ->
                    job.name + ": " + job.status + " " + (job.conclusion ?: "") +
                        job.steps.joinToString("", "\n  ", "") { step -> "\n  - ${step.name}: ${step.status} ${step.conclusion ?: ""}" }
                }
                _state.update { it.copy(buildLogs = text, message = "Loaded logs for $buildId") }
            }.onFailure {
                _state.update { it.copy(message = "Build logs unavailable") }
            }
        }
    }

    fun refreshTasks(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.listTasks(token).onSuccess { tasks -> _state.update { it.copy(tasks = tasks) } }
        }
    }

    fun createTask() {
        val token = _state.value.token ?: return
        val description = _state.value.newTaskDescription.trim()
        if (description.isBlank()) return
        viewModelScope.launch {
            client.createTask(token, description).onSuccess { task ->
                _state.update { it.copy(newTaskDescription = "", message = "Task created: ${task.id}") }
                refreshTasks(token)
            }.onFailure {
                _state.update { it.copy(message = "Task creation failed") }
            }
        }
    }

    fun updateTask(taskId: String, status: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.updateTask(token, taskId, status).onSuccess { refreshTasks(token) }
                .onFailure { _state.update { it.copy(message = "Task update failed") } }
        }
    }

    fun cancelTask(taskId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.cancelTask(token, taskId).onSuccess { refreshTasks(token) }
                .onFailure { _state.update { it.copy(message = "Task cancellation failed") } }
        }
    }

    fun generateImage() {
        val token = _state.value.token ?: return
        val prompt = _state.value.imagePrompt.trim()
        if (prompt.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.generateImage(token, prompt, 512).onSuccess { image ->
                _state.update { it.copy(loading = false, message = "Generated image ${image.id}") }
                refreshImages(token)
            }.onFailure {
                _state.update { it.copy(loading = false, message = "Image generation failed") }
            }
        }
    }

    fun refreshImages(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            client.listImages(token).onSuccess { images -> _state.update { it.copy(images = images) } }
        }
    }

    fun openGithubOAuth() = startGithubOAuth()

    fun updateApkArtifactId(value: String) = _state.update { it.copy(apkArtifactIdInput = value) }

    fun selectBuildForDelivery(buildId: String) {
        _state.update {
            it.copy(
                selectedBuildId = buildId,
                buildArtifacts = emptyList(),
                selectedArtifactId = null,
                apkArtifactIdInput = "",
                apkDownloadUrl = null,
                apkDownloadExpiresAt = null,
                apkChecksum = null,
                apkDeliveryMessage = null,
            )
        }
        refreshBuildArtifacts(buildId)
    }

    fun refreshBuildArtifacts(requestedBuildId: String? = null) {
        val buildId = requestedBuildId ?: _state.value.selectedBuildId ?: return
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.buildArtifacts(token, buildId).onSuccess { artifacts ->
                _state.update {
                    it.copy(
                        buildArtifacts = artifacts,
                        selectedArtifactId = artifacts.firstOrNull()?.id,
                        apkArtifactIdInput = artifacts.firstOrNull()?.id?.toString() ?: it.apkArtifactIdInput,
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = if (artifacts.isEmpty()) "No artifacts available for this build" else null,
                    )
                }
            }.onFailure {
                _state.update { it.copy(apkDeliveryLoading = false, apkDeliveryMessage = "Unable to load build artifacts") }
            }
        }
    }

    fun selectArtifact(artifactId: Long) {
        _state.update { it.copy(selectedArtifactId = artifactId, apkArtifactIdInput = artifactId.toString()) }
    }

    fun createApkDownloadLink() {
        val token = _state.value.token ?: return
        val buildId = _state.value.selectedBuildId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Select a build first") }
            return
        }
        val artifactId = _state.value.apkArtifactIdInput.toLongOrNull() ?: _state.value.selectedArtifactId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Enter a valid artifact ID") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.apkDownloadLink(token, buildId, artifactId).onSuccess { link ->
                _state.update {
                    it.copy(
                        apkDownloadUrl = link.url,
                        apkDownloadExpiresAt = link.expiresAt,
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = "Download link created",
                    )
                }
            }.onFailure {
                _state.update { it.copy(apkDeliveryLoading = false, apkDeliveryMessage = "Download link unavailable for this build/artifact") }
            }
        }
    }

    fun loadApkChecksum() {
        val token = _state.value.token ?: return
        val buildId = _state.value.selectedBuildId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Select a build first") }
            return
        }
        val artifactId = _state.value.apkArtifactIdInput.toLongOrNull() ?: _state.value.selectedArtifactId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Enter a valid artifact ID") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.apkChecksum(token, buildId, artifactId).onSuccess { checksum ->
                _state.update {
                    it.copy(
                        apkChecksum = checksum,
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = "APK checksum loaded",
                    )
                }
            }.onFailure {
                _state.update { it.copy(apkDeliveryLoading = false, apkDeliveryMessage = "APK checksum unavailable") }
            }
        }
    }

    fun openApkDownload() {
        val url = _state.value.apkDownloadUrl ?: return
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        context.startActivity(intent)
    }
}
