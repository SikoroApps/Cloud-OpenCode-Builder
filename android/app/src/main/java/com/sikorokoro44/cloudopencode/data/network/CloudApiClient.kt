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
