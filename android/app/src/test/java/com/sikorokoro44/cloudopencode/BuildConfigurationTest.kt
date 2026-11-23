package com.sikorokoro44.cloudopencode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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
}