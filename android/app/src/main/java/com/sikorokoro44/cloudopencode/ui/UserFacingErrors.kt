package com.sikorokoro44.cloudopencode.ui

import com.sikorokoro44.cloudopencode.data.network.CloudApiError

enum class MessageSeverity { Info, Success, Error }

data class UiMessage(val text: String, val severity: MessageSeverity = MessageSeverity.Info)

/** Turns backend/network failures into actionable text without leaking raw exception details. */
object UserFacingErrors {
    fun describe(error: Throwable?, fallback: String): String {
        val detail = when (error) {
            is CloudApiError.Http -> when (error.code) {
                401 -> "Your session expired. Sign in again."
                403 -> "This action is not permitted for your account or selected project."
                404 -> "The requested resource was not found."
                429 -> "Too many requests. Wait a moment and try again."
                else -> error.errorMessage.replace('_', ' ').trim().takeIf { it.isNotBlank() }
            }
            is CloudApiError.Network -> error.errorMessage.trim().takeIf { it.isNotBlank() }
            else -> null
        }
        return detail ?: fallback
    }

    fun isUnauthorized(error: Throwable?): Boolean = error is CloudApiError.Http && error.code == 401
}
