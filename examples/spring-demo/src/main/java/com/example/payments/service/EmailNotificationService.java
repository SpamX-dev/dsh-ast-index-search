package com.example.payments.service;

import com.example.payments.model.Payment;
import org.springframework.stereotype.Service;

/**
 * Email-backed {@link NotificationService}.
 */
@Service
public class EmailNotificationService implements NotificationService {

    @Override
    public void notifyPaymentCreated(Payment payment) {
        send("payment.created", payment.getId());
    }

    @Override
    public void notifyPaymentCaptured(Payment payment) {
        send("payment.captured", payment.getId());
    }

    private void send(String event, String paymentId) {
        // Imagine an email / SQS dispatch here.
        System.out.println("[" + event + "] " + paymentId);
    }
}
