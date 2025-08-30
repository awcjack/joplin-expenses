/**
 * Safe DOM manipulation utilities for content scripts
 */

/**
 * Safely query a DOM element with validation
 */
export function safeQuerySelector(selector: string): Element | null {
    try {
        if (!selector || typeof selector !== 'string') {
            return null;
        }
        
        const element = document.querySelector(selector);
        
        // Validate that element is actually a DOM element
        if (element && element.nodeType === Node.ELEMENT_NODE) {
            return element;
        }
        
        return null;
    } catch (error) {
        console.warn(`[DOMUtils] Failed to query selector "${selector}":`, error);
        return null;
    }
}

/**
 * Safely query multiple DOM elements
 */
export function safeQuerySelectorAll(selector: string): NodeListOf<Element> | null {
    try {
        if (!selector || typeof selector !== 'string') {
            return null;
        }
        
        const elements = document.querySelectorAll(selector);
        return elements.length > 0 ? elements : null;
    } catch (error) {
        console.warn(`[DOMUtils] Failed to query selector all "${selector}":`, error);
        return null;
    }
}

/**
 * Safely get element bounding client rect
 */
export function safeGetBoundingClientRect(element: Element | null): DOMRect | null {
    try {
        if (!element || !element.getBoundingClientRect) {
            return null;
        }
        
        return element.getBoundingClientRect();
    } catch (error) {
        console.warn('[DOMUtils] Failed to get bounding client rect:', error);
        return null;
    }
}

/**
 * Safely set element style property
 */
export function safeSetStyle(element: Element | null, property: string, value: string): boolean {
    try {
        if (!element || !property || typeof property !== 'string') {
            return false;
        }
        
        const htmlElement = element as HTMLElement;
        if (htmlElement.style && typeof htmlElement.style === 'object') {
            (htmlElement.style as any)[property] = value;
            return true;
        }
        
        return false;
    } catch (error) {
        console.warn(`[DOMUtils] Failed to set style property "${property}":`, error);
        return false;
    }
}

/**
 * Safely add event listener with cleanup tracking
 */
export function safeAddEventListener(
    element: Element | null,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
): () => void {
    try {
        if (!element || !event || !handler) {
            return () => {}; // Return empty cleanup function
        }
        
        element.addEventListener(event, handler, options);
        
        // Return cleanup function
        return () => {
            try {
                element.removeEventListener(event, handler, options);
            } catch (cleanupError) {
                console.warn('[DOMUtils] Failed to remove event listener:', cleanupError);
            }
        };
    } catch (error) {
        console.warn(`[DOMUtils] Failed to add event listener for "${event}":`, error);
        return () => {}; // Return empty cleanup function
    }
}

/**
 * Safely create and configure DOM element
 */
export function safeCreateElement<T extends keyof HTMLElementTagNameMap>(
    tagName: T,
    attributes?: Record<string, string>,
    textContent?: string
): HTMLElementTagNameMap[T] | null {
    try {
        const element = document.createElement(tagName);
        
        if (attributes) {
            for (const [key, value] of Object.entries(attributes)) {
                if (typeof key === 'string' && typeof value === 'string') {
                    // Sanitize attribute values to prevent injection
                    const safeValue = value.replace(/[<>"'&]/g, '');
                    element.setAttribute(key, safeValue);
                }
            }
        }
        
        if (textContent && typeof textContent === 'string') {
            // Use textContent instead of innerHTML to prevent XSS
            element.textContent = textContent;
        }
        
        return element;
    } catch (error) {
        console.warn(`[DOMUtils] Failed to create element "${tagName}":`, error);
        return null;
    }
}

/**
 * Safely remove element from DOM
 */
export function safeRemoveElement(element: Element | null): boolean {
    try {
        if (!element || !element.parentNode) {
            return false;
        }
        
        element.parentNode.removeChild(element);
        return true;
    } catch (error) {
        console.warn('[DOMUtils] Failed to remove element:', error);
        return false;
    }
}

/**
 * Check if element is visible and interactable
 */
export function isElementVisible(element: Element | null): boolean {
    try {
        if (!element) {
            return false;
        }
        
        const rect = safeGetBoundingClientRect(element);
        if (!rect) {
            return false;
        }
        
        return rect.width > 0 && rect.height > 0 && 
               rect.top >= 0 && rect.left >= 0;
    } catch (error) {
        console.warn('[DOMUtils] Failed to check element visibility:', error);
        return false;
    }
}

/**
 * Find the best positioned parent element for positioning popups
 */
export function findPositioningParent(element: Element | null): Element | null {
    try {
        let current = element;
        let attempts = 0;
        const maxAttempts = 10; // Prevent infinite loops
        
        while (current && attempts < maxAttempts) {
            const computedStyle = window.getComputedStyle(current);
            const position = computedStyle.position;
            
            if (position === 'relative' || position === 'absolute' || position === 'fixed') {
                return current;
            }
            
            current = current.parentElement;
            attempts++;
        }
        
        // Fallback to document body
        return document.body;
    } catch (error) {
        console.warn('[DOMUtils] Failed to find positioning parent:', error);
        return document.body;
    }
}