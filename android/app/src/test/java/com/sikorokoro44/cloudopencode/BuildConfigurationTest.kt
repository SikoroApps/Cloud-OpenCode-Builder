package com.sikorokoro44.cloudopencode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class BuildConfigurationTest {
    @Test
    fun applicationIdUsesStableNamespaceWithDebugSuffix() {
        assertEquals("com.sikorokoro44.cloudopencode.debug", BuildConfig.APPLICATION_ID)
    }

    @Test
    fun versionNameIsSet() {
        assertEquals("0.1.0", BuildConfig.VERSION_NAME)
    }

    @Test
    fun debugBuildHasDebuggingEnabled() {
        assertTrue(BuildConfig.DEBUG)
    }

    @Test
    fun backendUrlIsBlankOrSecureAndNeverAPlaceholder() {
        val url = BuildConfig.CLOUD_BASE_URL
        if (url.isBlank()) return
        assertTrue("backend URL must use https", url.startsWith("https://"))
        assertFalse("placeholder backend is forbidden", url.contains("cloud-opencode-backend.example"))
        val host = runCatching { URI(url).host }.getOrNull()
        assertFalse("reserved example host is forbidden", host.isNullOrBlank() || host.endsWith(".example"))
    }
}