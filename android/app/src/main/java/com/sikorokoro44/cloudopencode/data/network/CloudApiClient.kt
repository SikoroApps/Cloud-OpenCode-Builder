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
    fun register(email: String, password: String): Result<CloudToken>
    fun login(email: String, password: String): Result<CloudToken>
    fun logout(token: String): Result<Unit>
    fun history(token: String, sessionKey: String): Result<List<ChatMessageDto>>
    fun sendChat(token: String, sessionKey: String, content: String): Result<CloudChatResponse>
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
        val request: Request = if (body != null) {
            builder.method(method, body.toString().toRequestBody(mediaType)).build()
        } else {
            builder.method(method, null).build()
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
