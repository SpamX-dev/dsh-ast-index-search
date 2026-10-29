package com.example.payments.service;

import com.example.payments.model.Payment;
import com.example.payments.model.PaymentStatus;
import com.example.payments.repository.PaymentRepository;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * Orchestrates the payment lifecycle and side-effects (notifications).
 */
@Service
public class PaymentServiceImpl implements PaymentService {

    private final PaymentRepository repository;
    private final NotificationService notificationService;

    public PaymentServiceImpl(PaymentRepository repository, NotificationService notificationService) {
        this.repository = repository;
        this.notificationService = notificationService;
    }

    @Override
    public Payment createPayment(Payment payment) {
        Payment saved = repository.save(payment);
        notificationService.notifyPaymentCreated(saved);
        return saved;
    }

    @Override
    public Payment authorizePayment(String id) {
        Payment payment = requirePayment(id);
        payment.setStatus(PaymentStatus.AUTHORIZED);
        return repository.save(payment);
    }

    @Override
    public Payment capturePayment(String id) {
        Payment payment = requirePayment(id);
        payment.setStatus(PaymentStatus.CAPTURED);
        notificationService.notifyPaymentCaptured(payment);
        return repository.save(payment);
    }

    @Override
    public Optional<Payment> getPayment(String id) {
        return repository.findById(id);
    }

    private Payment requirePayment(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Payment not found: " + id));
    }
}
