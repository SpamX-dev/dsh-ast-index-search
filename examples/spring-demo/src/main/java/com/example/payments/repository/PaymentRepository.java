package com.example.payments.repository;

import com.example.payments.model.Payment;

import java.util.List;
import java.util.Optional;

/**
 * Persistence port for payments.
 */
public interface PaymentRepository {

    Payment save(Payment payment);

    Optional<Payment> findById(String id);

    List<Payment> findByStatus(String status);
}
