package com.sikorokoro44.cloudopencode

import com.sikorokoro44.cloudopencode.data.network.CloudApiError
import com.sikorokoro44.cloudopencode.ui.GithubOAuthResult
import com.sikorokoro44.cloudopencode.ui.MessageSeverity
import com.sikorokoro44.cloudopencode.ui.UiMessage
import com.sikorokoro44.cloudopencode.ui.UserFacingErrors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UserFacingErrorsTest {
    @Test
    fun backendErrorsBecomeReadableMessages() {
        assertEquals("Your session expired. Sign in again.", UserFacingErrors.describe(CloudApiError.Http(401, "unauthorized"), "failed"))
        assertEquals("Too many requests. Wait a moment and try again.", UserFacingErrors.describe(CloudApiError.Http(429, "rate_limited"), "failed"))
        assertEquals("github not configured", UserFacingErrors.describe(CloudApiError.Http(409, "github_not_configured"), "failed"))
        assertEquals("backend URL must be an allowed HTTPS URL", UserFacingErrors.describe(CloudApiError.Network("backend URL must be an allowed HTTPS URL"), "failed"))
        assertEquals("failed", UserFacingErrors.describe(null, "failed"))
    }

    @Test
    fun unauthorizedDetectionDrivesReauthentication() {
        assertTrue(UserFacingErrors.isUnauthorized(CloudApiError.Http(401, "unauthorized")))
        assertFalse(UserFacingErrors.isUnauthorized(CloudApiError.Http(403, "forbidden")))
        assertFalse(UserFacingErrors.isUnauthorized(null))
    }

    @Test
    fun messagesCarrySeverity() {
        assertEquals(MessageSeverity.Error, UiMessage("failed", MessageSeverity.Error).severity)
        assertEquals(MessageSeverity.Info, UiMessage("loading").severity)
    }

    @Test
    fun onlyTheDeclaredGithubCallbackPathIsAccepted() {
        assertTrue(GithubOAuthResult.isCallback("cloudopencode", "github", "/callback"))
        assertTrue(GithubOAuthResult.isCallback("cloudopencode", "github", "/callback/next"))
        assertFalse(GithubOAuthResult.isCallback("cloudopencode", "github", "/other"))
        assertFalse(GithubOAuthResult.isCallback("cloudopencode", "evil", "/callback"))
        assertFalse(GithubOAuthResult.isCallback("https", "github", "/callback"))
    }
}
