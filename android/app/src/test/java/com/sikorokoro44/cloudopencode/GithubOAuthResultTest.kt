package com.sikorokoro44.cloudopencode

import com.sikorokoro44.cloudopencode.ui.GithubOAuthResult
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GithubOAuthResultTest {
    @Test
    fun connectedStatusIsRecognized() {
        assertTrue(GithubOAuthResult.isConnected("connected"))
        assertFalse(GithubOAuthResult.isConnected("error"))
        assertFalse(GithubOAuthResult.isConnected(null))
        assertTrue(GithubOAuthResult.message("connected", null).contains("connected"))
    }

    @Test
    fun errorsProduceActionableMessages() {
        assertTrue(GithubOAuthResult.message(null, "github_denied").contains("cancelled"))
        assertTrue(GithubOAuthResult.message(null, "insufficient_scopes").contains("public_repo and workflow"))
        assertTrue(GithubOAuthResult.message(null, "invalid_state").contains("expired"))
        assertTrue(GithubOAuthResult.message(null, "oauth_failed").contains("oauth_failed"))
        assertTrue(GithubOAuthResult.message(null, null).contains("no status"))
    }
}
