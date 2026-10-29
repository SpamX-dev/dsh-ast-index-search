package com.example.payments.service;

import com.example.payments.model.Payment;

import java.util.Optional;

/**
 * Payment domain service.
 */
public interface PaymentService {

    Payment createPayment(Payment payment);

    Payment authorizePayment(String id);

    Payment capturePayment(String id);

    Optional<Payment> getPayment(String id);
}
