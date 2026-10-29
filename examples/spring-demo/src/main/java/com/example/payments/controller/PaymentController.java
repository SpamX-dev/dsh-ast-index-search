package com.example.payments.controller;

import com.example.payments.model.Payment;
import com.example.payments.service.PaymentService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * HTTP surface for the payments domain.
 */
@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping
    public Payment create(@RequestBody Payment payment) {
        return paymentService.createPayment(payment);
    }

    @GetMapping("/{id}")
    public Optional<Payment> get(@PathVariable String id) {
        return paymentService.getPayment(id);
    }

    @PostMapping("/{id}/authorize")
    public Payment authorize(@PathVariable String id) {
        return paymentService.authorizePayment(id);
    }

    @PostMapping("/{id}/capture")
    public Payment capture(@PathVariable String id) {
        return paymentService.capturePayment(id);
    }

    @GetMapping("/health")
    public String health() {
        return "ok";
    }
}
