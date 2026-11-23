package com.sikorokoro44.cloudopencode.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelFallbackTest {
    @Test
    fun chainHasFiveFreeModelsInPriorityOrder() {
        assertEquals(5, ModelFallback.chain.size)
        assertEquals("opencode/big-pickle", ModelFallback.chain[0])
        assertEquals("openrouter/google/gemma-4-26b-a4b-it:free", ModelFallback.chain[4])
    }

    @Test
    fun nextAdvancesThroughChain() {
        assertEquals("opencode/deepseek-v4.1-flash-free", ModelFallback.next("opencode/big-pickle"))
        assertEquals("openrouter/google/gemma-4-26b-a4b-it:free",
            ModelFallback.next("openrouter/baidu/ernie-5.5-flash-preview:free"))
    }

    @Test
    fun nextReturnsNullAtEndOrUnknown() {
        assertNull(ModelFallback.next("openrouter/google/gemma-4-26b-a4b-it:free"))
        assertNull(ModelFallback.next("not-a-model"))
    }

    @Test
    fun eligibleStatusCodesIncludeRateLimitAndServerErrors() {
        assertTrue(ModelFallback.isEligibleStatusCode(429))
        assertTrue(ModelFallback.isEligibleStatusCode(503))
        assertFalse(ModelFallback.isEligibleStatusCode(404))
        assertFalse(ModelFallback.isEligibleStatusCode(200))
    }

    @Test
    fun firstAfterStartsAtFirstWhenNull() {
        assertEquals("opencode/big-pickle", ModelFallback.firstAfter(null))
    }
}