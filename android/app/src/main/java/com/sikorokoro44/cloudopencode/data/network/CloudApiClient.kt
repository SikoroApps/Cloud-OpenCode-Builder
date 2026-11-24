package com.sikorokoro44.cloudopencode.data.network

import com.sikorokoro44.cloudopencode.BuildConfig
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

interface CloudApiClient {
    fun baseUrl(): String
    fun allowedHosts(): Set<String>
    fun isSecureUrl(url: String): Boolean
    fun health(): Result<Unit>
    fun register(email: String, password: String): Result<CloudToken>
    fun login(email: String, password: String): Result<CloudToken>
    fun logout(token: String): Result<Unit>
    fun history(token: String, sessionKey: String): Result<List<ChatMessageDto>>
    fun sendChat(token: String, sessionKey: String, content: String): Result<CloudChatResponse>
    fun githubOAuthStart(token: String): Result<GithubOAuthStart>
    fun githubStatus(token: String): Result<GithubStatus>
    fun githubDisconnect(token: String): Result<GithubDisconnectResult>
    fun githubRepositories(token: String): Result<List<GithubRepository>>
    fun createGithubRepository(token: String, name: String, description: String): Result<GithubRepository>
    fun selectGithubProject(token: String, repoFullName: String): Result<GithubProject>
    fun selectedGithubProject(token: String): Result<GithubProject?>
    fun projectFiles(token: String): Result<List<ProjectFile>>
    fun projectFile(token: String, path: String): Result<ProjectFile>
    fun saveProjectFile(token: String, path: String, content: String): Result<ProjectFile>
    fun aiEditFiles(token: String, instruction: String): Result<AiFilePlanResult>
    fun commitProject(token: String, message: String): Result<ProjectCommitResult>
    fun projectCommits(token: String): Result<List<ProjectCommit>>
    fun createBuildWorkflow(token: String): Result<ProjectFile>
    fun startBuild(token: String, workflowPath: String, ref: String): Result<ProjectBuild>
    fun builds(token: String): Result<List<ProjectBuild>>
    fun build(token: String, buildId: String): Result<ProjectBuild>
    fun refreshBuild(token: String, buildId: String): Result<ProjectBuild>
    fun buildLogs(token: String, buildId: String): Result<BuildLogSummary>
    fun buildArtifacts(token: String, buildId: String): Result<List<BuildArtifact>>
    fun apkDownloadLink(token: String, buildId: String, artifactId: Long): Result<ApkDownloadLink>
    fun apkChecksum(token: String, buildId: String, artifactId: Long): Result<ApkChecksum>
    fun addLauncherIcon(token: String): Result<List<String>>
    fun signedReleaseWorkflow(token: String): Result<ReleaseTemplate>
}

class CloudApiClientImpl(
    private val configuredBaseUrl: String = BuildConfig.CLOUD_BASE_URL,
    private val configuredAllowedHosts: Set<String> = emptySet(),
) : CloudApiClient {
    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .callTimeout(90, TimeUnit.SECONDS)
        .build()

    override fun baseUrl(): String = configuredBaseUrl

    override fun health(): Result<Unit> = runCatching {
        request("GET", "/health", null, null)
        Unit
    }

    override fun allowedHosts(): Set<String> = configuredAllowedHosts

    override fun isSecureUrl(url: String): Boolean {
        if (!url.startsWith("https://")) return false
        val host = runCatching { java.net.URI(url).host }.getOrNull() ?: return false
        return configuredAllowedHosts.isEmpty() || configuredAllowedHosts.contains(host)
    }

    override fun register(email: String, password: String): Result<CloudToken> {
        val body = JSONObject().put("email", email).put("password", password)
        val response: JSONObject = runCatching { request("POST", "/api/auth/register", null, body) }
            .getOrElse { throw CloudApiError.Network("register failed") }
        val token = response.optString("token")
        return if (token.isNotBlank()) Result.success(CloudToken(token)) else Result.failure(CloudApiError.Network("register failed"))
    }

    override fun login(email: String, password: String): Result<CloudToken> {
        val body = JSONObject().put("email", email).put("password", password)
        val response: JSONObject = runCatching { request("POST", "/api/auth/login", null, body) }
            .getOrElse { throw CloudApiError.Network("login failed") }
        val token = response.optString("token")
        return if (token.isNotBlank()) Result.success(CloudToken(token)) else Result.failure(CloudApiError.Network("login failed"))
    }

    override fun logout(token: String): Result<Unit> {
        return runCatching { request("POST", "/api/auth/logout", token, null) }
            .map { Unit }
    }

    override fun history(token: String, sessionKey: String): Result<List<ChatMessageDto>> {
        return runCatching {
            val response = request("GET", "/api/chat/history?sessionKey=${java.net.URLEncoder.encode(sessionKey, "UTF-8")}", token, null)
            val array = response.optJSONArray("history") ?: throw CloudApiError.Network("history failed")
            val messages = ArrayList<ChatMessageDto>()
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                messages.add(
                    ChatMessageDto(
                        id = item.optLong("id"),
                        userId = item.optString("userId"),
                        sessionKey = item.optString("sessionKey"),
                        role = item.optString("role"),
                        content = item.optString("content"),
                        model = if (item.isNull("model")) null else item.optString("model"),
                        createdAt = item.optLong("createdAt"),
                        updatedAt = item.optLong("updatedAt"),
                    ),
                )
            }
            messages
        }
    }

    override fun sendChat(token: String, sessionKey: String, content: String): Result<CloudChatResponse> {
        val body = JSONObject().put("sessionKey", sessionKey).put("content", content)
        return runCatching { request("POST", "/api/chat", token, body) }.map { raw ->
            val response = raw
            val userMessage = response.optJSONObject("userMessage")?.let(::messageFromJson)
                ?: throw CloudApiError.Network("chat failed")
            val assistantMessage = response.optJSONObject("assistantMessage")?.let(::messageFromJson)
                ?: throw CloudApiError.Network("chat failed")
            val aiObject = response.optJSONObject("ai")
            val ai = aiObject?.let {
                AiResultDto(
                    model = it.optString("model"),
                    content = it.optString("content"),
                    finishReason = it.optString("finishReason"),
                    attempts = ArrayList<AiAttemptDto>(),
                )
            }
            CloudChatResponse(userMessage, assistantMessage, ai)
        }
    }

    override fun githubOAuthStart(token: String): Result<GithubOAuthStart> = runCatching {
        val response = request("GET", "/api/github/oauth/start", token, null)
        val url = response.optString("authorizationUrl")
        if (!url.startsWith("https://")) throw CloudApiError.Network("invalid OAuth URL")
        GithubOAuthStart(url, response.optInt("expiresIn"))
    }

    override fun githubStatus(token: String): Result<GithubStatus> = runCatching {
        val response = request("GET", "/api/github/status", token, null)
        GithubStatus(
            configured = response.optBoolean("configured"),
            connected = response.optBoolean("connected"),
            login = if (response.isNull("login")) null else response.optString("login"),
            scopes = if (response.isNull("scopes")) null else response.optString("scopes"),
            connectedAt = if (response.isNull("connectedAt")) null else response.optLong("connectedAt"),
        )
    }

    override fun githubDisconnect(token: String): Result<GithubDisconnectResult> = runCatching {
        val response = request("DELETE", "/api/github", token, null)
        GithubDisconnectResult(
            disconnected = response.optBoolean("disconnected"),
            revoked = response.optBoolean("revoked"),
        )
    }

    override fun githubRepositories(token: String): Result<List<GithubRepository>> = runCatching {
        val response = request("GET", "/api/github/repositories", token, null)
        val array = response.optJSONArray("repositories") ?: throw CloudApiError.Network("repository list failed")
        val repositories = ArrayList<GithubRepository>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            repositories.add(repositoryFromJson(item))
        }
        repositories
    }

    override fun createGithubRepository(token: String, name: String, description: String): Result<GithubRepository> = runCatching {
        val body = JSONObject().put("name", name).put("description", description)
        val response = request("POST", "/api/github/repositories", token, body)
        response.optJSONObject("repository")?.let(::repositoryFromJson)
            ?: throw CloudApiError.Network("repository creation failed")
    }

    override fun selectGithubProject(token: String, repoFullName: String): Result<GithubProject> = runCatching {
        val body = JSONObject().put("repoFullName", repoFullName)
        val response = request("PUT", "/api/github/selection", token, body)
        response.optJSONObject("project")?.let(::projectFromJson)
            ?: throw CloudApiError.Network("project selection failed")
    }

    override fun selectedGithubProject(token: String): Result<GithubProject?> = runCatching {
        val response = request("GET", "/api/github/selection", token, null)
        if (response.isNull("project")) null else response.optJSONObject("project")?.let(::projectFromJson)
    }

    override fun projectFiles(token: String): Result<List<ProjectFile>> = runCatching {
        val response = request("GET", "/api/projects/files", token, null)
        val array = response.optJSONArray("files") ?: throw CloudApiError.Network("project files failed")
        val files = ArrayList<ProjectFile>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            files.add(fileFromJson(item))
        }
        files
    }

    override fun projectFile(token: String, path: String): Result<ProjectFile> = runCatching {
        val encoded = java.net.URLEncoder.encode(path, "UTF-8")
        val response = request("GET", "/api/projects/file?path=$encoded", token, null)
        response.optJSONObject("file")?.let(::fileFromJson)
            ?: throw CloudApiError.Network("project file failed")
    }

    override fun saveProjectFile(token: String, path: String, content: String): Result<ProjectFile> = runCatching {
        val body = JSONObject().put("path", path).put("content", content)
        val response = request("PUT", "/api/projects/files", token, body)
        response.optJSONObject("file")?.let(::fileFromJson)
            ?: throw CloudApiError.Network("project file save failed")
    }

    override fun aiEditFiles(token: String, instruction: String): Result<AiFilePlanResult> = runCatching {
        val body = JSONObject().put("instruction", instruction)
        val response = request("POST", "/api/projects/ai-files", token, body)
        val array = response.optJSONArray("applied") ?: throw CloudApiError.Network("AI file edit failed")
        val applied = ArrayList<String>()
        for (index in 0 until array.length()) applied.add(array.optString(index))
        AiFilePlanResult(response.optString("model"), applied)
    }

    override fun commitProject(token: String, message: String): Result<ProjectCommitResult> = runCatching {
        val body = JSONObject().put("message", message)
        val response = request("POST", "/api/projects/commit", token, body)
        val array = response.optJSONArray("files") ?: throw CloudApiError.Network("commit failed")
        val files = ArrayList<CommittedFile>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            files.add(CommittedFile(
                path = item.optString("path"),
                sha = item.optString("sha"),
                htmlUrl = item.optString("htmlUrl"),
            ))
        }
        ProjectCommitResult(response.optString("status"), response.optString("commitId"), files)
    }

    override fun projectCommits(token: String): Result<List<ProjectCommit>> = runCatching {
        val response = request("GET", "/api/projects/commits", token, null)
        val array = response.optJSONArray("commits") ?: throw CloudApiError.Network("commit list failed")
        val commits = ArrayList<ProjectCommit>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            commits.add(ProjectCommit(
                id = item.optString("id"),
                status = item.optString("status"),
                commitSha = if (item.isNull("commitSha")) null else item.optString("commitSha"),
                message = item.optString("message"),
                error = if (item.isNull("error")) null else item.optString("error"),
                createdAt = item.optLong("createdAt"),
            ))
        }
        commits
    }

    override fun createBuildWorkflow(token: String): Result<ProjectFile> = runCatching {
        val response = request("POST", "/api/projects/build-workflow", token, JSONObject())
        response.optJSONObject("file")?.let(::fileFromJson)
            ?: throw CloudApiError.Network("build workflow creation failed")
    }

    override fun startBuild(token: String, workflowPath: String, ref: String): Result<ProjectBuild> = runCatching {
        val body = JSONObject().put("workflowPath", workflowPath).put("ref", ref)
        val response = request("POST", "/api/projects/builds", token, body)
        response.optJSONObject("build")?.let(::buildFromJson)
            ?: throw CloudApiError.Network("build dispatch failed")
    }

    override fun builds(token: String): Result<List<ProjectBuild>> = runCatching {
        val response = request("GET", "/api/projects/builds", token, null)
        val array = response.optJSONArray("builds") ?: throw CloudApiError.Network("build list failed")
        val result = ArrayList<ProjectBuild>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            result.add(buildFromJson(item))
        }
        result
    }

    override fun build(token: String, buildId: String): Result<ProjectBuild> = runCatching {
        val encoded = java.net.URLEncoder.encode(buildId, "UTF-8")
        val response = request("GET", "/api/projects/build?buildId=$encoded", token, null)
        response.optJSONObject("build")?.let(::buildFromJson)
            ?: throw CloudApiError.Network("build lookup failed")
    }

    override fun refreshBuild(token: String, buildId: String): Result<ProjectBuild> = runCatching {
        val body = JSONObject().put("buildId", buildId)
        val response = request("POST", "/api/projects/build/refresh", token, body)
        response.optJSONObject("build")?.let(::buildFromJson)
            ?: throw CloudApiError.Network("build refresh failed")
    }

    override fun buildLogs(token: String, buildId: String): Result<BuildLogSummary> = runCatching {
        val encoded = java.net.URLEncoder.encode(buildId, "UTF-8")
        val response = request("GET", "/api/projects/build/logs?buildId=$encoded", token, null)
        val jobsArray = response.optJSONArray("jobs") ?: throw CloudApiError.Network("build logs failed")
        val jobs = ArrayList<BuildJob>()
        for (index in 0 until jobsArray.length()) {
            val item = jobsArray.optJSONObject(index) ?: continue
            val stepsArray = item.optJSONArray("steps")
            val steps = ArrayList<BuildJobStep>()
            if (stepsArray != null) {
                for (stepIndex in 0 until stepsArray.length()) {
                    val step = stepsArray.optJSONObject(stepIndex) ?: continue
                    steps.add(BuildJobStep(
                        name = step.optString("name"),
                        status = step.optString("status"),
                        conclusion = if (step.isNull("conclusion")) null else step.optString("conclusion"),
                    ))
                }
            }
            jobs.add(BuildJob(
                id = item.optLong("id"),
                name = item.optString("name"),
                status = item.optString("status"),
                conclusion = if (item.isNull("conclusion")) null else item.optString("conclusion"),
                steps = steps,
            ))
        }
        val failedArray = response.optJSONArray("failedSteps")
        val failedSteps = ArrayList<FailedStep>()
        if (failedArray != null) {
            for (index in 0 until failedArray.length()) {
                val item = failedArray.optJSONObject(index) ?: continue
                failedSteps.add(FailedStep(item.optString("job"), item.optString("step")))
            }
        }
        BuildLogSummary(
            buildId = response.optString("buildId"),
            runId = response.optLong("runId"),
            status = response.optString("status"),
            conclusion = if (response.isNull("conclusion")) null else response.optString("conclusion"),
            logsUrl = response.optString("logsUrl"),
            jobs = jobs,
            failedSteps = failedSteps,
        )
    }

    override fun buildArtifacts(token: String, buildId: String): Result<List<BuildArtifact>> = runCatching {
        val encoded = java.net.URLEncoder.encode(buildId, "UTF-8")
        val response = request("GET", "/api/projects/build/artifacts?buildId=$encoded", token, null)
        val array = response.optJSONArray("artifacts") ?: throw CloudApiError.Network("artifact list failed")
        val artifacts = ArrayList<BuildArtifact>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            artifacts.add(BuildArtifact(
                id = item.optLong("id"),
                name = item.optString("name"),
                sizeInBytes = item.optLong("sizeInBytes"),
                expired = item.optBoolean("expired"),
                createdAt = item.optLong("createdAt"),
                downloadUrl = item.optString("downloadUrl"),
                browserUrl = item.optString("browserUrl"),
            ))
        }
        artifacts
    }

    override fun apkDownloadLink(token: String, buildId: String, artifactId: Long): Result<ApkDownloadLink> = runCatching {
        val body = JSONObject().put("buildId", buildId).put("artifactId", artifactId)
        val response = request("POST", "/api/projects/build/artifact/link", token, body)
        ApkDownloadLink(
            url = response.optString("url"),
            downloadUrl = response.optString("downloadUrl"),
            expiresAt = response.optLong("expiresAt"),
            expiresIn = response.optLong("expiresIn"),
        )
    }

    override fun apkChecksum(token: String, buildId: String, artifactId: Long): Result<ApkChecksum> = runCatching {
        val encoded = java.net.URLEncoder.encode(buildId, "UTF-8")
        val response = request(
            "GET",
            "/api/projects/build/artifact/checksum?buildId=$encoded&artifactId=$artifactId",
            token,
            null,
        )
        ApkChecksum(
            buildId = response.optString("buildId"),
            runId = response.optLong("runId"),
            artifactId = response.optLong("artifactId"),
            filename = response.optString("filename"),
            sizeInBytes = response.optLong("sizeInBytes"),
            sha256 = response.optString("sha256"),
        )
    }

    override fun addLauncherIcon(token: String): Result<List<String>> = runCatching {
        val response = request("POST", "/api/projects/launcher-icon", token, JSONObject())
        val array = response.optJSONArray("files") ?: throw CloudApiError.Network("launcher icon failed")
        val files = ArrayList<String>()
        for (index in 0 until array.length()) files.add(array.optString(index))
        files
    }

    override fun signedReleaseWorkflow(token: String): Result<ReleaseTemplate> = runCatching {
        val response = request("POST", "/api/projects/signed-release-workflow", token, JSONObject())
        val file = response.optJSONObject("file")?.let(::fileFromJson)
            ?: throw CloudApiError.Network("signed release template failed")
        val array = response.optJSONArray("requiredSecrets")
        val secrets = ArrayList<String>()
        if (array != null) {
            for (index in 0 until array.length()) secrets.add(array.optString(index))
        }
        ReleaseTemplate(file, secrets, response.optString("note"))
    }

    private fun buildFromJson(json: JSONObject): ProjectBuild = ProjectBuild(
        id = json.optString("id"),
        status = json.optString("status"),
        conclusion = if (json.isNull("conclusion")) null else json.optString("conclusion"),
        progress = json.optInt("progress"),
        workflowPath = json.optString("workflowPath"),
        ref = json.optString("ref"),
        runId = if (json.isNull("runId")) null else json.optLong("runId"),
        runUrl = if (json.isNull("runUrl")) null else json.optString("runUrl"),
        logsUrl = if (json.isNull("logsUrl")) null else json.optString("logsUrl"),
        error = if (json.isNull("error")) null else json.optString("error"),
        createdAt = json.optLong("createdAt"),
        updatedAt = json.optLong("updatedAt"),
    )

    private fun fileFromJson(json: JSONObject): ProjectFile = ProjectFile(
        path = json.optString("path"),
        content = json.optString("content"),
        dirty = json.optBoolean("dirty"),
        updatedAt = json.optLong("updatedAt"),
    )

    private fun repositoryFromJson(json: JSONObject): GithubRepository = GithubRepository(
        id = json.optLong("id"),
        fullName = json.optString("fullName"),
        name = json.optString("name"),
        owner = json.optString("owner"),
        isPrivate = json.optBoolean("isPrivate"),
        defaultBranch = json.optString("defaultBranch"),
        htmlUrl = json.optString("htmlUrl"),
    )

    private fun projectFromJson(json: JSONObject): GithubProject = GithubProject(
        id = json.optString("id"),
        repoId = json.optLong("repoId"),
        repoFullName = json.optString("repoFullName"),
        repoOwner = json.optString("repoOwner"),
        repoName = json.optString("repoName"),
        defaultBranch = json.optString("defaultBranch"),
        htmlUrl = json.optString("htmlUrl"),
    )

    private fun messageFromJson(json: JSONObject): ChatMessageDto = ChatMessageDto(
        id = json.optLong("id"),
        userId = json.optString("userId"),
        sessionKey = json.optString("sessionKey"),
        role = json.optString("role"),
        content = json.optString("content"),
        model = if (json.isNull("model")) null else json.optString("model"),
        createdAt = json.optLong("createdAt"),
        updatedAt = json.optLong("updatedAt"),
    )

    private fun request(method: String, path: String, token: String?, body: JSONObject?): JSONObject {
        if (!isSecureUrl(configuredBaseUrl)) {
            throw CloudApiError.Network("backend URL must be an allowed HTTPS URL")
        }
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val builder = Request.Builder()
            .url(configuredBaseUrl.trimEnd('/') + path)
        if (token != null) builder.addHeader("Authorization", "Bearer $token")
        val request: Request = when {
            body != null -> builder.method(method, body.toString().toRequestBody(mediaType)).build()
            method == "GET" -> builder.get().build()
            else -> builder.method(method, "".toRequestBody(mediaType)).build()
        }
        val response: Response = okHttpClient.newCall(request).execute()
        val responseBody = response.body?.string().orEmpty()
        val json = if (responseBody.isBlank()) JSONObject() else JSONObject(responseBody)
        if (!response.isSuccessful) {
            throw CloudApiError.Http(response.code, json.optString("error"))
        }
        return json
    }
}
