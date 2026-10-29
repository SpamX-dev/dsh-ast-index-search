package com.example.payments.service;

import com.example.payments.model.Payment;

/**
 * Outbound notification port.
 */
public interface NotificationService {

    void notifyPaymentCreated(Payment payment);

    void notifyPaymentCaptured(Payment payment);
}
