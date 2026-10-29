package com.example.payments.repository;

import com.example.payments.model.Payment;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory implementation of {@link PaymentRepository} — no real database.
 */
@Repository
public class JpaPaymentRepository implements PaymentRepository {

    private final ConcurrentHashMap<String, Payment> store = new ConcurrentHashMap<>();

    @Override
    public Payment save(Payment payment) {
        store.put(payment.getId(), payment);
        return payment;
    }

    @Override
    public Optional<Payment> findById(String id) {
        return Optional.ofNullable(store.get(id));
    }

    @Override
    public List<Payment> findByStatus(String status) {
        return store.values().stream()
                .filter(payment -> payment.getStatus().name().equals(status))
                .toList();
    }
}
