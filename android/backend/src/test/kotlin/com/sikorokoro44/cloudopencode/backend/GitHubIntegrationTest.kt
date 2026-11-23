package com.sikorokoro44.cloudopencode.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GitHubIntegrationTest {
    @Test
    fun leastPrivilegeSetAccepted() {
        assertTrue(GitHubScopes.isLeastPrivilege(setOf("contents:write", "actions:write", "metadata:read")))
    }

    @Test
    fun missingAndExcessiveScopesDetected() {
        val granted = setOf("contents:write", "metadata:read", "admin:org")
        assertEquals(setOf("actions:write"), GitHubScopes.missing(granted))
        assertEquals(setOf("admin:org"), GitHubScopes.excessive(granted))
        assertFalse(GitHubScopes.isLeastPrivilege(granted))
    }

    @Test
    fun connectedRepositoryKeepsMetadata() {
        val repo = ConnectedRepository("SikoroApps/Cloud-OpenCode-Builder", "main", false)
        assertEquals("main", repo.defaultBranch)
        assertFalse(repo.isPrivate)
    }
}
