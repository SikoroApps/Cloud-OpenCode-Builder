package com.sikorokoro44.cloudopencode.backend

/**
 * Free-model fallback chain for Cloud OpenCode. Only free models are ever used.
 * The agent tries models in order and advances after an eligible provider error,
 * rate limit or exhausted quota. Infinite retries are not allowed.
 */
object ModelFallback {
    val chain: List<String> = listOf(
        "opencode/big-pickle",
        "opencode/deepseek-v4.1-flash-free",
        "opencode/flint-40b-free",
        "openrouter/baidu/ernie-5.5-flash-preview:free",
        "openrouter/google/gemma-4-26b-a4b-it:free",
    )

    /** HTTP status codes that are eligible for fallback. */
    val eligibleStatusCodes: Set<Int> = setOf(401, 402, 429, 500, 502, 503, 504)

    fun isEligibleStatusCode(code: Int): Boolean = code in eligibleStatusCodes

    /** Returns the index of [model] in the chain, or -1 if not present. */
    fun indexOf(model: String): Int = chain.indexOf(model)

    /**
     * Returns the next model after [current], or null if [current] is the last model
     * or is not in the chain. Never wraps around.
     */
    fun next(current: String): String? {
        val idx = chain.indexOf(current)
        if (idx < 0 || idx + 1 >= chain.size) return null
        return chain[idx + 1]
    }

    /**
     * Walks the chain starting after [current] and returns the first candidate,
     * or null when exhausted. [current] may be null to start at the first model.
     */
    fun firstAfter(current: String?): String? {
        if (current == null) return chain.firstOrNull()
        return next(current)
    }
}