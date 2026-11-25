package com.sikorokoro44.cloudopencode.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sikorokoro44.cloudopencode.data.network.ApkChecksum
import com.sikorokoro44.cloudopencode.data.network.ApkDownloadLink
import com.sikorokoro44.cloudopencode.data.network.BuildArtifact
import com.sikorokoro44.cloudopencode.data.network.BuildLogSummary
import com.sikorokoro44.cloudopencode.data.network.CloudApiClient
import com.sikorokoro44.cloudopencode.data.network.CloudChatResponse
import com.sikorokoro44.cloudopencode.data.network.CloudImage
import com.sikorokoro44.cloudopencode.data.network.CloudTask
import com.sikorokoro44.cloudopencode.data.network.ConfigReadiness
import com.sikorokoro44.cloudopencode.data.network.GithubRepository
import com.sikorokoro44.cloudopencode.data.network.GithubStatus
import com.sikorokoro44.cloudopencode.data.network.ProjectBuild
import com.sikorokoro44.cloudopencode.data.network.ProjectCommit
import com.sikorokoro44.cloudopencode.data.network.ProjectFile
import com.sikorokoro44.cloudopencode.data.network.WebSearchResponse
import com.sikorokoro44.cloudopencode.security.EncryptedTokenStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChatMessageUi(val role: String, val content: String, val model: String? = null)

data class CloudUiState(
    val token: String? = null,
    val email: String? = null,
    val loading: Boolean = false,
    val message: UiMessage? = null,
    val canRetry: Boolean = false,
    val onboardingComplete: Boolean = false,
    val selectedTab: Int = 0,
    val themeMode: String = "system",
    val backendBaseUrl: String = "",
    val models: List<String> = emptyList(),
    val readiness: ConfigReadiness? = null,
    val chatSessionKey: String = "default",
    val chatInput: String = "",
    val chatMessages: List<ChatMessageUi> = emptyList(),
    val chatModel: String? = null,
    val chatAttempts: List<String> = emptyList(),
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
    val buildLogSummary: BuildLogSummary? = null,
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
    private val settings: AppSettings,
    private val context: Context,
) : ViewModel() {
    private val _state = MutableStateFlow(CloudUiState())
    val state: StateFlow<CloudUiState> = _state.asStateFlow()

    private var lastFailedAction: (() -> Unit)? = null
    private var buildPollJob: Job? = null

    init {
        _state.update {
            it.copy(
                onboardingComplete = settings.onboardingComplete,
                selectedTab = settings.selectedTab.coerceIn(0, TAB_COUNT - 1),
                themeMode = settings.themeMode,
                chatSessionKey = settings.chatSessionKey(),
                webSearch = settings.webSearch,
                backendBaseUrl = client.baseUrl(),
            )
        }
        val stored = tokenStore.load()
        if (!stored.isNullOrBlank()) {
            _state.update { it.copy(token = stored) }
            refreshAll(stored)
        }
    }

    // ---- User messages and session -------------------------------------------------------

    fun dismissMessage() = _state.update { it.copy(message = null) }

    fun retryLastAction() {
        val action = lastFailedAction
        if (action == null) {
            _state.update { it.copy(message = UiMessage("Nothing to retry", MessageSeverity.Info)) }
            return
        }
        _state.update { it.copy(canRetry = false) }
        action()
    }

    fun completeOnboarding() {
        settings.onboardingComplete = true
        _state.update { it.copy(onboardingComplete = true) }
    }

    fun setTab(index: Int) {
        val selected = index.coerceIn(0, TAB_COUNT - 1)
        settings.selectedTab = selected
        _state.update { it.copy(selectedTab = selected) }
        when (selected) {
            TAB_GITHUB -> refreshGithub()
            TAB_BUILDS -> {
                refreshBuilds()
                pollBuilds()
            }
            TAB_CHAT -> if (_state.value.chatMessages.isEmpty()) refreshChatHistory()
            else -> Unit
        }
    }

    fun setThemeMode(value: String) {
        val mode = if (value in setOf("light", "dark", "system")) value else "system"
        settings.themeMode = mode
        _state.update { it.copy(themeMode = mode) }
    }

    fun clearMessage() = dismissMessage()
    fun updateChatInput(value: String) = _state.update { it.copy(chatInput = value) }
    fun updateRepoName(value: String) = _state.update { it.copy(repoNameInput = value) }
    fun updateRepoDescription(value: String) = _state.update { it.copy(repoDescriptionInput = value) }
    fun updateFileDraft(value: String) = _state.update { it.copy(fileDraft = value) }
    fun updateAiInstruction(value: String) = _state.update { it.copy(aiInstruction = value) }
    fun updateCommitMessage(value: String) = _state.update { it.copy(commitMessage = value) }
    fun updateBuildWorkflowPath(value: String) = _state.update { it.copy(buildWorkflowPath = value) }
    fun updateBuildRef(value: String) = _state.update { it.copy(buildRef = value) }
    fun updateTaskDescription(value: String) = _state.update { it.copy(newTaskDescription = value) }
    fun updateImagePrompt(value: String) = _state.update { it.copy(imagePrompt = value) }
    fun updateWebSearch(value: Boolean) {
        settings.webSearch = value
        _state.update { it.copy(webSearch = value) }
    }

    private fun succeed(text: String) {
        lastFailedAction = null
        _state.update { it.copy(message = UiMessage(text, MessageSeverity.Success), canRetry = false) }
    }

    private fun inform(text: String) = _state.update { it.copy(message = UiMessage(text, MessageSeverity.Info)) }

    private fun report(
        fallback: String,
        error: Throwable? = null,
        retry: (() -> Unit)? = null,
        changeLoading: Boolean = true,
    ) {
        val text = UserFacingErrors.describe(error, fallback)
        if (UserFacingErrors.isUnauthorized(error)) {
            clearSession()
            _state.update { it.copy(message = UiMessage(text, MessageSeverity.Error)) }
            return
        }
        lastFailedAction = retry
        _state.update {
            it.copy(
                message = UiMessage(text, MessageSeverity.Error),
                canRetry = retry != null,
                loading = if (changeLoading) false else it.loading,
                apkDeliveryLoading = if (changeLoading) false else it.apkDeliveryLoading,
            )
        }
    }

    private fun clearSession() {
        buildPollJob?.cancel()
        lastFailedAction = null
        _state.update {
            it.copy(
                canRetry = false,
                token = null,
                email = null,
                loading = false,
                chatMessages = emptyList(),
                githubStatus = null,
                repositories = emptyList(),
                selectedProjectName = null,
                files = emptyList(),
                builds = emptyList(),
                apkDownloadUrl = null,
            )
        }
    }

    fun register(email: String, password: String) = authenticate(email, password, true)
    fun login(email: String, password: String) = authenticate(email, password, false)

    private fun authenticate(email: String, password: String, register: Boolean) {
        if (!email.contains("@") || password.length < 8) {
            _state.update { it.copy(message = UiMessage("Enter an email address and a password of at least 8 characters", MessageSeverity.Error)) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            val result = if (register) client.register(email, password) else client.login(email, password)
            result.onSuccess { token ->
                tokenStore.save(token.token)
                _state.update { it.copy(token = token.token, email = email, loading = false) }
                succeed("Authenticated")
                refreshAll(token.token)
            }.onFailure { error ->
                report(if (register) "Registration failed" else "Sign in failed", error) {
                    authenticate(email, password, register)
                }
            }
        }
    }

    fun logout() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            val result = client.logout(token)
            tokenStore.clear()
            clearSession()
            val message = if (result.isSuccess) {
                UiMessage("Logged out", MessageSeverity.Success)
            } else {
                UiMessage("Signed out locally; backend logout failed", MessageSeverity.Error)
            }
            _state.update { it.copy(message = message) }
        }
    }

    fun refreshAll(requestedToken: String? = null) {
        val token = requestedToken ?: _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            val me = client.me(token)
            if (me.isFailure) {
                report("Could not verify your account", me.exceptionOrNull())
                _state.update { it.copy(loading = false) }
                return@launch
            }
            _state.update { it.copy(email = me.getOrNull()?.email ?: _state.value.email) }
            client.models().onSuccess { models -> _state.update { it.copy(models = models) } }
                .onFailure { error -> report("Model list unavailable", error, changeLoading = false) }
            client.configReadiness().onSuccess { readiness -> _state.update { it.copy(readiness = readiness) } }
                .onFailure { error -> report("Configuration status unavailable", error, changeLoading = false) }
            fetchHistory(token, _state.value.chatSessionKey)
            fetchGithub(token)
            fetchFiles(token)
            fetchCommits(token)
            fetchBuilds(token)
            fetchTasks(token)
            fetchImages(token)
            _state.update { it.copy(loading = false) }
        }
    }

    // ---- Chat ----------------------------------------------------------------------------

    fun switchChatSession(value: String) {
        val key = value.trim().ifBlank { "default" }
        settings.saveChatSessionKey(key)
        _state.update {
            it.copy(chatSessionKey = key, chatMessages = emptyList(), chatModel = null, chatAttempts = emptyList())
        }
        refreshChatHistory()
    }

    fun newChat() {
        switchChatSession("chat-${System.currentTimeMillis()}")
        inform("New conversation started")
    }

    fun refreshChatHistory() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchHistory(token, _state.value.chatSessionKey) }
    }

    private suspend fun fetchHistory(token: String, sessionKey: String) {
        client.history(token, sessionKey).onSuccess { history ->
            _state.update {
                it.copy(chatMessages = history.map { message -> ChatMessageUi(message.role, message.content, message.model) })
            }
        }.onFailure { error -> report("Chat history unavailable", error, changeLoading = false) }
    }

    fun sendChat() {
        val token = _state.value.token ?: return
        val content = _state.value.chatInput.trim()
        if (content.isBlank()) {
            _state.update { it.copy(message = UiMessage("Enter a message first", MessageSeverity.Error)) }
            return
        }
        sendChatMessage(token, _state.value.chatSessionKey, content, _state.value.webSearch)
    }

    private fun sendChatMessage(token: String, sessionKey: String, content: String, webSearch: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            client.sendChat(token, sessionKey, content, webSearch).onSuccess { response: CloudChatResponse ->
                val currentSession = _state.value.chatSessionKey
                if (currentSession != sessionKey) return@onSuccess
                val messages = _state.value.chatMessages.toMutableList()
                response.userMessage?.let { messages.add(ChatMessageUi(it.role, it.content, it.model)) }
                response.assistantMessage?.let { messages.add(ChatMessageUi(it.role, it.content, it.model)) }
                _state.update {
                    it.copy(
                        chatMessages = messages,
                        chatInput = "",
                        chatModel = response.ai?.model ?: response.assistantMessage?.model,
                        chatAttempts = response.ai?.attempts?.map { attempt -> "${attempt.model}: ${attempt.finishReason}" } ?: emptyList(),
                        lastSearch = response.webSearch,
                        loading = false,
                    )
                }
                succeed("Response received")
            }.onFailure { error ->
                report("Chat failed", error) { sendChatMessage(token, sessionKey, content, webSearch) }
            }
        }
    }

    // ---- GitHub --------------------------------------------------------------------------

    fun refreshGithub() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchGithub(token) }
    }

    private suspend fun fetchGithub(token: String) {
        client.githubStatus(token).onSuccess { status -> _state.update { it.copy(githubStatus = status) } }
            .onFailure { error -> report("GitHub status unavailable", error, changeLoading = false) }
        client.githubRepositories(token).onSuccess { repos -> _state.update { it.copy(repositories = repos) } }
            .onFailure { error -> report("Repository list unavailable", error, changeLoading = false) }
        client.selectedGithubProject(token).onSuccess { project ->
            _state.update { it.copy(selectedProjectName = project?.repoFullName) }
        }.onFailure { error -> report("Selected project unavailable", error, changeLoading = false) }
    }

    fun openGithubOAuth() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.githubOAuthStart(token).onSuccess { oauth ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(oauth.authorizationUrl)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                val opened = runCatching { context.startActivity(intent) }.isSuccess
                _state.update {
                    it.copy(
                        message = UiMessage(
                            if (opened) "Complete GitHub authorization in the browser; the app will reconnect automatically."
                            else "No browser available to start GitHub authorization",
                            if (opened) MessageSeverity.Info else MessageSeverity.Error,
                        ),
                    )
                }
            }.onFailure { error ->
                report("Unable to start GitHub OAuth; check backend GitHub configuration", error)
            }
        }
    }

    fun handleGithubOAuthCallback(status: String?, error: String?) {
        val message = GithubOAuthResult.message(status, error)
        _state.update {
            it.copy(message = UiMessage(message, if (GithubOAuthResult.isConnected(status)) MessageSeverity.Success else MessageSeverity.Error))
        }
        setTab(TAB_GITHUB)
        if (GithubOAuthResult.isConnected(status)) refreshGithub()
    }

    fun createRepository() {
        val token = _state.value.token ?: return
        val current = _state.value
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.createGithubRepository(token, current.repoNameInput, current.repoDescriptionInput)
                .onSuccess { repo ->
                    succeed("Repository created: ${repo.fullName}")
                    fetchGithub(token)
                }.onFailure { error ->
                    report("Repository creation failed", error) { createRepository() }
                }
            _state.update { it.copy(loading = false) }
        }
    }

    fun selectRepository(fullName: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.selectGithubProject(token, fullName).onSuccess { project ->
                succeed("Selected ${project.repoFullName}")
                fetchFiles(token)
                fetchCommits(token)
                fetchBuilds(token)
            }.onFailure { error ->
                report("Project selection failed", error) { selectRepository(fullName) }
            }
            _state.update { it.copy(loading = false) }
        }
    }

    fun disconnectGithub() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.githubDisconnect(token).onSuccess { result ->
                if (result.disconnected) {
                    succeed(if (result.revoked) "GitHub disconnected and token revoked" else "GitHub disconnected")
                } else {
                    _state.update { it.copy(message = UiMessage("GitHub disconnect was not confirmed", MessageSeverity.Error)) }
                }
                fetchGithub(token)
            }.onFailure { error -> report("GitHub disconnect failed", error) }
        }
    }

    // ---- Files and commits ---------------------------------------------------------------

    fun refreshFiles() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchFiles(token) }
    }

    private suspend fun fetchFiles(token: String) {
        client.projectFiles(token).onSuccess { files -> _state.update { it.copy(files = files) } }
            .onFailure { error -> report("Project files unavailable", error, changeLoading = false) }
    }

    fun selectFile(path: String) {
        val file = _state.value.files.firstOrNull { it.path == path } ?: return
        _state.update { it.copy(selectedFilePath = path, fileDraft = file.content) }
    }

    fun saveSelectedFile() {
        val token = _state.value.token ?: return
        val path = _state.value.selectedFilePath
        if (path == null) {
            _state.update { it.copy(message = UiMessage("Select a file before saving", MessageSeverity.Error)) }
            return
        }
        val draft = _state.value.fileDraft
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.saveProjectFile(token, path, draft).onSuccess { file ->
                succeed("Saved ${file.path}")
                fetchFiles(token)
            }.onFailure { error -> report("File save failed", error) { saveSelectedFile() } }
            _state.update { it.copy(loading = false) }
        }
    }

    fun aiEditFiles() {
        val token = _state.value.token ?: return
        val instruction = _state.value.aiInstruction.trim()
        if (instruction.isBlank()) {
            _state.update { it.copy(message = UiMessage("Enter an AI instruction first", MessageSeverity.Error)) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.aiEditFiles(token, instruction).onSuccess { result ->
                succeed("AI edited ${result.applied.size} file(s) with ${result.model}")
                fetchFiles(token)
            }.onFailure { error -> report("AI file edit failed", error) { aiEditFiles() } }
            _state.update { it.copy(loading = false) }
        }
    }

    fun commitProject() {
        val token = _state.value.token ?: return
        val message = _state.value.commitMessage
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.commitProject(token, message).onSuccess { result ->
                succeed("Commit ${result.commitId}: ${result.status}")
                fetchFiles(token)
                fetchCommits(token)
            }.onFailure { error -> report("Commit failed", error) { commitProject() } }
            _state.update { it.copy(loading = false) }
        }
    }

    fun refreshCommits() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchCommits(token) }
    }

    private suspend fun fetchCommits(token: String) {
        client.projectCommits(token).onSuccess { commits -> _state.update { it.copy(commits = commits) } }
            .onFailure { error -> report("Commit history unavailable", error, changeLoading = false) }
    }

    fun createBuildWorkflow() {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.createBuildWorkflow(token).onSuccess {
                succeed("Build workflow saved")
                fetchFiles(token)
            }.onFailure { error -> report("Build workflow creation failed", error) }
        }
    }

    // ---- Builds and APK delivery ---------------------------------------------------------

    fun startBuild() {
        startBuildWith(_state.value.buildWorkflowPath, _state.value.buildRef)
    }

    private fun startBuildWith(workflowPath: String, ref: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.startBuild(token, workflowPath, ref).onSuccess { build ->
                _state.update {
                    it.copy(
                        selectedBuildId = build.id,
                        buildArtifacts = emptyList(),
                        selectedArtifactId = null,
                        apkArtifactIdInput = "",
                        apkDownloadUrl = null,
                        apkDownloadExpiresAt = null,
                        apkChecksum = null,
                        apkDeliveryMessage = "Build started; APK delivery becomes available when it succeeds",
                    )
                }
                succeed("Build started: ${build.id}")
                fetchBuilds(token)
                pollBuilds()
            }.onFailure { error ->
                report("Build start failed", error) { startBuildWith(workflowPath, ref) }
            }
            _state.update { it.copy(loading = false) }
        }
    }

    fun retryBuild(buildId: String) {
        val build = _state.value.builds.firstOrNull { it.id == buildId } ?: return
        startBuildWith(build.workflowPath, build.ref)
    }

    fun refreshBuilds() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchBuilds(token) }
    }

    private suspend fun fetchBuilds(token: String): List<ProjectBuild> {
        val result = client.builds(token)
        result.onSuccess { builds -> _state.update { it.copy(builds = builds) } }
            .onFailure { error -> report("Build list unavailable", error, changeLoading = false) }
        return result.getOrDefault(emptyList())
    }

    fun pollBuilds() {
        val token = _state.value.token ?: return
        buildPollJob?.cancel()
        buildPollJob = viewModelScope.launch {
            repeat(60) { attempt ->
                val builds = fetchBuilds(token)
                if (builds.none { it.status == "queued" || it.status == "in_progress" }) {
                    if (attempt > 0) inform("Build polling finished")
                    return@launch
                }
                delay(5_000)
            }
            inform("Build is still running; refresh the build list to continue monitoring")
        }
    }

    fun refreshBuild(buildId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.refreshBuild(token, buildId).onSuccess { build ->
                succeed("Build ${build.id}: ${build.status} ${build.conclusion ?: ""}")
                fetchBuilds(token)
            }.onFailure { error -> report("Build refresh failed", error) { refreshBuild(buildId) } }
        }
    }

    fun loadBuildLogs(buildId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.buildLogs(token, buildId).onSuccess { logs ->
                val text = buildString {
                    if (logs.failedSteps.isNotEmpty()) {
                        append("Failed steps:\n")
                        append(logs.failedSteps.joinToString("\n") { "${it.job} / ${it.step}" })
                        append("\n\n")
                    }
                    append(
                        logs.jobs.joinToString("\n") { job ->
                            job.name + ": " + job.status + " " + (job.conclusion ?: "") +
                                job.steps.joinToString("", "\n  ", "") { step -> "\n  - ${step.name}: ${step.status} ${step.conclusion ?: ""}" }
                        },
                    )
                }
                _state.update { it.copy(buildLogs = text, buildLogSummary = logs) }
                succeed("Loaded logs for $buildId")
            }.onFailure { error -> report("Build logs unavailable", error) { loadBuildLogs(buildId) } }
        }
    }

    fun updateApkArtifactId(value: String) = _state.update { it.copy(apkArtifactIdInput = value) }

    fun selectBuildForDelivery(buildId: String) {
        val build = _state.value.builds.firstOrNull { it.id == buildId }
        _state.update {
            it.copy(
                selectedBuildId = buildId,
                buildArtifacts = emptyList(),
                selectedArtifactId = null,
                apkArtifactIdInput = "",
                apkDownloadUrl = null,
                apkDownloadExpiresAt = null,
                apkChecksum = null,
                apkDeliveryMessage = ApkDelivery.deliveryStatusMessage(build),
            )
        }
        if (ApkDelivery.buildReady(build)) refreshBuildArtifacts(buildId)
    }

    fun refreshBuildArtifacts(requestedBuildId: String? = null) {
        val buildId = requestedBuildId ?: _state.value.selectedBuildId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Select a successful build first") }
            return
        }
        val build = _state.value.builds.firstOrNull { it.id == buildId }
        if (build != null && !ApkDelivery.buildReady(build)) {
            _state.update { it.copy(apkDeliveryMessage = ApkDelivery.deliveryStatusMessage(build)) }
            return
        }
        val token = _state.value.token ?: return
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.buildArtifacts(token, buildId).onSuccess { artifacts ->
                val preferred = ApkDelivery.preferredArtifact(artifacts)
                _state.update {
                    it.copy(
                        buildArtifacts = artifacts,
                        selectedArtifactId = preferred?.id,
                        apkArtifactIdInput = preferred?.id?.toString() ?: "",
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = when {
                            artifacts.isEmpty() -> "No artifacts available for this build"
                            artifacts.all { artifact -> artifact.expired } -> "All artifacts expired; start a new build"
                            else -> "Loaded ${artifacts.size} artifact(s); selected ${preferred?.name ?: "none"}"
                        },
                    )
                }
            }.onFailure { error ->
                _state.update {
                    it.copy(
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = UserFacingErrors.describe(error, "Unable to load build artifacts"),
                    )
                }
            }
        }
    }

    fun selectArtifact(artifactId: Long) {
        val artifact = _state.value.buildArtifacts.firstOrNull { it.id == artifactId }
        if (artifact?.expired == true) {
            _state.update { it.copy(apkDeliveryMessage = "That artifact expired; choose a current one") }
            return
        }
        _state.update { it.copy(selectedArtifactId = artifactId, apkArtifactIdInput = artifactId.toString()) }
    }

    private fun selectedNonExpiredArtifact(): BuildArtifact? {
        val artifactId = _state.value.apkArtifactIdInput.toLongOrNull() ?: _state.value.selectedArtifactId ?: return null
        val artifact = _state.value.buildArtifacts.firstOrNull { it.id == artifactId }
        return if (artifact == null || artifact.expired) null else artifact
    }

    fun createApkDownloadLink() {
        val token = _state.value.token ?: return
        val buildId = _state.value.selectedBuildId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Select a build first") }
            return
        }
        val build = _state.value.builds.firstOrNull { it.id == buildId }
        if (!ApkDelivery.buildReady(build)) {
            _state.update { it.copy(apkDeliveryMessage = ApkDelivery.deliveryStatusMessage(build)) }
            return
        }
        val artifact = selectedNonExpiredArtifact() ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Choose a current, non-expired artifact") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.apkDownloadLink(token, buildId, artifact.id).onSuccess { link: ApkDownloadLink ->
                _state.update {
                    it.copy(
                        apkDownloadUrl = link.url,
                        apkDownloadExpiresAt = link.expiresAt,
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = "Download link created for ${artifact.name}",
                    )
                }
            }.onFailure { error ->
                _state.update {
                    it.copy(
                        apkDeliveryLoading = false,
                        apkDeliveryMessage = UserFacingErrors.describe(error, "Download link unavailable for this build/artifact"),
                    )
                }
            }
        }
    }

    fun loadApkChecksum() {
        val token = _state.value.token ?: return
        val buildId = _state.value.selectedBuildId ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Select a build first") }
            return
        }
        val build = _state.value.builds.firstOrNull { it.id == buildId }
        if (!ApkDelivery.buildReady(build)) {
            _state.update { it.copy(apkDeliveryMessage = ApkDelivery.deliveryStatusMessage(build)) }
            return
        }
        val artifact = selectedNonExpiredArtifact() ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Choose a current, non-expired artifact") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(apkDeliveryLoading = true, apkDeliveryMessage = null) }
            client.apkChecksum(token, buildId, artifact.id).onSuccess { checksum ->
                _state.update {
                    it.copy(apkChecksum = checksum, apkDeliveryLoading = false, apkDeliveryMessage = "APK checksum loaded")
                }
            }.onFailure { error ->
                _state.update {
                    it.copy(apkDeliveryLoading = false, apkDeliveryMessage = UserFacingErrors.describe(error, "APK checksum unavailable"))
                }
            }
        }
    }

    fun openApkDownload() {
        val url = _state.value.apkDownloadUrl ?: run {
            _state.update { it.copy(apkDeliveryMessage = "Create a download link first") }
            return
        }
        if (!client.isSecureUrl(url)) {
            _state.update { it.copy(apkDeliveryMessage = "Refusing to open a URL that is not an allowed HTTPS download link") }
            return
        }
        runCatching {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            context.startActivity(intent)
        }.onFailure {
            _state.update { it.copy(apkDeliveryMessage = "No browser available to open the APK download link") }
        }
    }

    // ---- Tasks and images ----------------------------------------------------------------

    fun refreshTasks() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchTasks(token) }
    }

    private suspend fun fetchTasks(token: String) {
        client.listTasks(token).onSuccess { tasks -> _state.update { it.copy(tasks = tasks) } }
            .onFailure { error -> report("Task list unavailable", error, changeLoading = false) }
    }

    fun createTask() {
        val token = _state.value.token ?: return
        val description = _state.value.newTaskDescription.trim()
        if (description.isBlank()) {
            _state.update { it.copy(message = UiMessage("Enter a task description first", MessageSeverity.Error)) }
            return
        }
        viewModelScope.launch {
            client.createTask(token, description).onSuccess { task ->
                succeed("Task created: ${task.id}")
                fetchTasks(token)
            }.onFailure { error -> report("Task creation failed", error) }
        }
    }

    fun updateTask(taskId: String, status: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.updateTask(token, taskId, status).onSuccess {
                succeed("Task $taskId set to $status")
                fetchTasks(token)
            }.onFailure { error -> report("Task update failed", error) }
        }
    }

    fun cancelTask(taskId: String) {
        val token = _state.value.token ?: return
        viewModelScope.launch {
            client.cancelTask(token, taskId).onSuccess {
                succeed("Task $taskId cancelled")
                fetchTasks(token)
            }.onFailure { error -> report("Task cancellation failed", error) }
        }
    }

    fun generateImage() {
        val token = _state.value.token ?: return
        val prompt = _state.value.imagePrompt.trim()
        if (prompt.isBlank()) {
            _state.update { it.copy(message = UiMessage("Enter an image prompt first", MessageSeverity.Error)) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            client.generateImage(token, prompt, 512).onSuccess { image ->
                succeed("Generated image ${image.id}")
                fetchImages(token)
            }.onFailure { error -> report("Image generation failed", error) }
            _state.update { it.copy(loading = false) }
        }
    }

    fun refreshImages() {
        val token = _state.value.token ?: return
        viewModelScope.launch { fetchImages(token) }
    }

    private suspend fun fetchImages(token: String) {
        client.listImages(token).onSuccess { images -> _state.update { it.copy(images = images) } }
            .onFailure { error -> report("Image list unavailable", error, changeLoading = false) }
    }

    fun openImage(imageId: String) {
        val image = _state.value.images.firstOrNull { it.id == imageId } ?: return
        if (!client.isSecureUrl(image.contentUrl)) {
            _state.update { it.copy(message = UiMessage("Image URL is not an allowed HTTPS URL", MessageSeverity.Error)) }
            return
        }
        runCatching {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(image.contentUrl)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            context.startActivity(intent)
        }.onFailure {
            _state.update { it.copy(message = UiMessage("No browser available to open the image", MessageSeverity.Error)) }
        }
    }

    override fun onCleared() {
        buildPollJob?.cancel()
        super.onCleared()
    }

    private companion object {
        const val TAB_COUNT = 8
        const val TAB_HOME = 0
        const val TAB_CHAT = 1
        const val TAB_GITHUB = 3
        const val TAB_BUILDS = 4
    }
}
