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

data class GithubRepository(
    val id: Long,
    val fullName: String,
    val name: String,
    val owner: String,
    val isPrivate: Boolean,
    val defaultBranch: String,
    val htmlUrl: String,
)

data class GithubProject(
    val id: String,
    val repoId: Long,
    val repoFullName: String,
    val repoOwner: String,
    val repoName: String,
    val defaultBranch: String,
    val htmlUrl: String,
)

data class ProjectFile(
    val path: String,
    val content: String,
    val dirty: Boolean,
    val updatedAt: Long,
)

data class AiFilePlanResult(
    val model: String,
    val applied: List<String>,
)

data class CommittedFile(
    val path: String,
    val sha: String,
    val htmlUrl: String,
)

data class ProjectCommitResult(
    val status: String,
    val commitId: String,
    val files: List<CommittedFile>,
)

data class ProjectCommit(
    val id: String,
    val status: String,
    val commitSha: String?,
    val message: String,
    val error: String?,
    val createdAt: Long,
)

data class ProjectBuild(
    val id: String,
    val status: String,
    val conclusion: String?,
    val progress: Int,
    val workflowPath: String,
    val ref: String,
    val runId: Long?,
    val runUrl: String?,
    val logsUrl: String?,
    val error: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class BuildJobStep(
    val name: String,
    val status: String,
    val conclusion: String?,
)

data class BuildJob(
    val id: Long,
    val name: String,
    val status: String,
    val conclusion: String?,
    val steps: List<BuildJobStep>,
)

data class FailedStep(
    val job: String,
    val step: String,
)

data class BuildLogSummary(
    val buildId: String,
    val runId: Long,
    val status: String,
    val conclusion: String?,
    val logsUrl: String,
    val jobs: List<BuildJob>,
    val failedSteps: List<FailedStep>,
)

data class BuildArtifact(
    val id: Long,
    val name: String,
    val sizeInBytes: Long,
    val expired: Boolean,
    val createdAt: Long,
    val downloadUrl: String,
    val browserUrl: String,
)

data class ApkDownloadLink(
    val url: String,
    val downloadUrl: String,
    val expiresAt: Long,
    val expiresIn: Long,
)

data class ApkChecksum(
    val buildId: String,
    val runId: Long,
    val artifactId: Long,
    val filename: String,
    val sizeInBytes: Long,
    val sha256: String,
)

data class ReleaseTemplate(
    val file: ProjectFile,
    val requiredSecrets: List<String>,
    val note: String,
)

sealed class CloudApiError(message: String) : Exception(message) {
    data class Http(val code: Int, val errorMessage: String) : CloudApiError(errorMessage)
    data class Network(val errorMessage: String) : CloudApiError(errorMessage)
}
