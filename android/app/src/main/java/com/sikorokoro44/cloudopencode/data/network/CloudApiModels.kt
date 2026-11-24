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

sealed class CloudApiError(message: String) : Exception(message) {
    data class Http(val code: Int, val errorMessage: String) : CloudApiError(errorMessage)
    data class Network(val errorMessage: String) : CloudApiError(errorMessage)
}
