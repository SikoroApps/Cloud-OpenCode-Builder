package com.sikorokoro44.cloudopencode.data.network

data class CloudUser(val id: String, val email: String)

data class CloudToken(val token: String)

data class AiAttemptDto(
    val model: String,
    val content: String,
    val finishReason: String,
)

data class AiResultDto(
    val model: String,
    val content: String,
    val finishReason: String,
    val attempts: List<AiAttemptDto>,
)

data class ChatMessageDto(
    val id: Long,
    val userId: String,
    val sessionKey: String,
    val role: String,
    val content: String,
    val model: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class CloudChatResponse(
    val userMessage: ChatMessageDto?,
    val assistantMessage: ChatMessageDto?,
    val ai: AiResultDto?,
)

data class GithubOAuthStart(
    val authorizationUrl: String,
    val expiresIn: Int,
)

data class GithubStatus(
    val configured: Boolean,
    val connected: Boolean,
    val login: String?,
    val scopes: String?,
    val connectedAt: Long?,
)

data class GithubDisconnectResult(
    val disconnected: Boolean,
    val revoked: Boolean,
)

sealed class CloudApiError(message: String) : Exception(message) {
    data class Http(val code: Int, val errorMessage: String) : CloudApiError(errorMessage)
    data class Network(val errorMessage: String) : CloudApiError(errorMessage)
}
