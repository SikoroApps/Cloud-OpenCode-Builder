package com.sikorokoro44.cloudopencode.ui

/**
 * Maps the backend deep-link callback result to a user-facing message.
 */
object GithubOAuthResult {
    fun isConnected(status: String?): Boolean = status == "connected"

    fun message(status: String?, error: String?): String = when {
        isConnected(status) -> "GitHub connected"
        error == "github_denied" -> "GitHub authorization was cancelled"
        error == "insufficient_scopes" -> "GitHub authorization needs public_repo and workflow scopes"
        error == "github_not_configured" -> "Backend GitHub OAuth is not configured"
        error == "invalid_state" -> "GitHub authorization expired; start it again"
        error != null -> "GitHub authorization failed: $error"
        else -> "GitHub authorization returned no status"
    }
}
