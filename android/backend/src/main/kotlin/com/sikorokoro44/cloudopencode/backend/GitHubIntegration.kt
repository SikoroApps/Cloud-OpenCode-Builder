package com.sikorokoro44.cloudopencode.backend

/** Least-privilege fine-grained GitHub permission sets used by the platform. */
object GitHubScopes {
    val required: Set<String> = setOf("contents:write", "actions:write", "metadata:read")

    fun isLeastPrivilege(granted: Set<String>): Boolean = granted == required

    fun missing(granted: Set<String>): Set<String> = required - granted

    fun excessive(granted: Set<String>): Set<String> = granted - required
}

data class ConnectedRepository(
    val fullName: String,
    val defaultBranch: String,
    val isPrivate: Boolean,
)
