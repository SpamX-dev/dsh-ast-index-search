package com.example.payments.model;

/**
 * Lifecycle of a payment.
 */
public enum PaymentStatus {
    PENDING,
    AUTHORIZED,
    CAPTURED,
    FAILED,
    REFUNDED
}
