;; trustbox.clar
;;
;; ============================================
;; title: trustbox
;; version: 1
;; summary: A secure escrow smart contract for Stacks blockchain.
;; description: Lock STX between buyer and seller, release when both approve, or refund if cancelled.
;; ============================================

;; traits
;;
;; ============================================
;; token definitions
;;
;; ============================================
;; constants
;;

;; Counter Error Codes (decorative, for testing)
(define-constant ERR_UNDERFLOW (err u100))

;; Escrow Error Codes
(define-constant ERR_INVALID_AMOUNT (err u101))
(define-constant ERR_ESCROW_NOT_FOUND (err u102))
(define-constant ERR_NOT_AUTHORIZED (err u103))
(define-constant ERR_INVALID_STATUS (err u104))
(define-constant ERR_TRANSFER_FAILED (err u105))
(define-constant ERR_ALREADY_APPROVED (err u106))
(define-constant ERR_SELF_ESCROW (err u107))

;; Status Constants
(define-constant STATUS_PENDING "pending")
(define-constant STATUS_BUYER_APPROVED "buyer-approved")
(define-constant STATUS_SELLER_APPROVED "seller-approved")
(define-constant STATUS_COMPLETED "completed")
(define-constant STATUS_CANCELLED "cancelled")

;; ============================================
;; data vars
;;

;; Counter for general testing (decorative as requested)
(define-data-var counter uint u0)

;; Escrow ID counter
(define-data-var next-escrow-id uint u0)

;; ============================================
;; data maps
;;

;; Map to store escrow details: key=escrow-id, value=escrow-data
(define-map escrows
  uint
  {
    buyer: principal,
    seller: principal,
    amount: uint,
    buyer-approved: bool,
    seller-approved: bool,
    status: (string-ascii 20),
    created-at: uint
  }
)

;; ============================================
;; public functions
;;

;; --- Counter Functions (decorative, for testing) ---

;; Public function to increment the counter
(define-public (increment)
  (let
    ((new-value (+ (var-get counter) u1)))
    (begin
      (var-set counter new-value)
      (print {
        event: "counter-incremented",
        caller: tx-sender,
        new-value: new-value,
        block-height: block-height
      })
      (ok new-value)
    )
  )
)

;; Public function to decrement the counter
(define-public (decrement)
  (let 
    ((current-value (var-get counter)))
    (begin
      ;; Prevent underflow
      (asserts! (> current-value u0) ERR_UNDERFLOW)
      (let
        ((new-value (- current-value u1)))
        (begin
          (var-set counter new-value)
          (print {
            event: "counter-decremented",
            caller: tx-sender,
            new-value: new-value,
            block-height: block-height
          })
          (ok new-value)
        )
      )
    )
  )
)

;; --- Escrow Core Functions ---

;; Create a new escrow
;; @param seller: The principal receiving funds upon approval
;; @param amount: Amount of STX to lock (in micro-STX)
;; @returns: Escrow ID
(define-public (create-escrow (seller principal) (amount uint))
  (let
    (
      (escrow-id (var-get next-escrow-id))
      (buyer tx-sender)
    )
    (begin
      ;; Validation
      (asserts! (> amount u0) ERR_INVALID_AMOUNT)
      (asserts! (not (is-eq buyer seller)) ERR_SELF_ESCROW)

      ;; Transfer STX from buyer to contract
      (try! (stx-transfer? amount buyer (as-contract tx-sender)))

      ;; Create escrow record
      (map-set escrows escrow-id
        {
          buyer: buyer,
          seller: seller,
          amount: amount,
          buyer-approved: false,
          seller-approved: false,
          status: STATUS_PENDING,
          created-at: block-height
        }
      )

      ;; Increment escrow ID counter
      (var-set next-escrow-id (+ escrow-id u1))

      ;; Emit event
      (print {
        event: "escrow-created",
        escrow-id: escrow-id,
        buyer: buyer,
        seller: seller,
        amount: amount,
        block-height: block-height
      })

      (ok escrow-id)
    )
  )
)

;; Approve release of funds
;; Both buyer and seller must call this
;; @param escrow-id: ID of the escrow to approve
;; @returns: true on success
(define-public (approve-release (escrow-id uint))
  (let
    (
      (escrow-data (unwrap! (map-get? escrows escrow-id) ERR_ESCROW_NOT_FOUND))
      (buyer (get buyer escrow-data))
      (seller (get seller escrow-data))
      (amount (get amount escrow-data))
      (is-buyer (is-eq tx-sender buyer))
      (is-seller (is-eq tx-sender seller))
      (buyer-approved (get buyer-approved escrow-data))
      (seller-approved (get seller-approved escrow-data))
      (current-status (get status escrow-data))
    )
    (begin
      ;; Validation
      (asserts! (or is-buyer is-seller) ERR_NOT_AUTHORIZED)
      (asserts! (is-eq current-status STATUS_PENDING) ERR_INVALID_STATUS)

      ;; Check if already approved by this party
      (asserts! (not (and is-buyer buyer-approved)) ERR_ALREADY_APPROVED)
      (asserts! (not (and is-seller seller-approved)) ERR_ALREADY_APPROVED)

      ;; Update approval status
      (let
        (
          (new-buyer-approved (if is-buyer true buyer-approved))
          (new-seller-approved (if is-seller true seller-approved))
          (both-approved (and new-buyer-approved new-seller-approved))
        )
        (begin
          ;; If both approved, transfer funds and mark completed
          (if both-approved
            (begin
              ;; Mark as completed before transfer (prevents reentrancy)
              (map-set escrows escrow-id
                (merge escrow-data {
                  buyer-approved: true,
                  seller-approved: true,
                  status: STATUS_COMPLETED
                })
              )

              ;; Transfer funds from contract to seller
              (try! (as-contract (stx-transfer? amount tx-sender seller)))

              ;; Emit completion event
              (print {
                event: "escrow-completed",
                escrow-id: escrow-id,
                buyer: buyer,
                seller: seller,
                amount: amount,
                block-height: block-height
              })
              true
            )
            ;; Otherwise just update approval status
            (begin
              (map-set escrows escrow-id
                (merge escrow-data {
                  buyer-approved: new-buyer-approved,
                  seller-approved: new-seller-approved
                })
              )

              ;; Emit approval event
              (print {
                event: "escrow-approved",
                escrow-id: escrow-id,
                approver: tx-sender,
                buyer-approved: new-buyer-approved,
                seller-approved: new-seller-approved,
                block-height: block-height
              })
              true
            )
          )

          (ok true)
        )
      )
    )
  )
)

;; Cancel escrow and refund buyer
;; Either party can call this
;; @param escrow-id: ID of the escrow to cancel
;; @returns: true on success
(define-public (cancel-escrow (escrow-id uint))
  (let
    (
      (escrow-data (unwrap! (map-get? escrows escrow-id) ERR_ESCROW_NOT_FOUND))
      (buyer (get buyer escrow-data))
      (seller (get seller escrow-data))
      (amount (get amount escrow-data))
      (is-buyer (is-eq tx-sender buyer))
      (is-seller (is-eq tx-sender seller))
      (current-status (get status escrow-data))
    )
    (begin
      ;; Validation
      (asserts! (or is-buyer is-seller) ERR_NOT_AUTHORIZED)
      (asserts! (is-eq current-status STATUS_PENDING) ERR_INVALID_STATUS)

      ;; Mark as cancelled before transfer (prevents reentrancy)
      (map-set escrows escrow-id
        (merge escrow-data {
          status: STATUS_CANCELLED
        })
      )

      ;; Refund STX from contract to buyer
      (try! (as-contract (stx-transfer? amount tx-sender buyer)))

      ;; Emit event
      (print {
        event: "escrow-cancelled",
        escrow-id: escrow-id,
        cancelled-by: tx-sender,
        buyer: buyer,
        seller: seller,
        amount: amount,
        block-height: block-height
      })

      (ok true)
    )
  )
)

;; ============================================
;; read only functions
;;

;; Read-only function to get the current counter value (decorative)
(define-read-only (get-counter)
  (ok (var-get counter))
)

;; Read-only function to get the current block height
(define-read-only (get-current-block)
  (ok block-height)
)

;; Get full escrow information
;; @param escrow-id: ID of the escrow
;; @returns: Escrow data or error
(define-read-only (get-escrow-info (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow-data (ok escrow-data)
    ERR_ESCROW_NOT_FOUND
  )
)

;; Get escrow status
;; @param escrow-id: ID of the escrow
;; @returns: Status string or error
(define-read-only (get-escrow-status (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow-data (ok (get status escrow-data))
    ERR_ESCROW_NOT_FOUND
  )
)

;; Get next escrow ID
(define-read-only (get-next-escrow-id)
  (ok (var-get next-escrow-id))
)

;; Check if escrow exists
;; @param escrow-id: ID to check
;; @returns: true if exists, false otherwise
(define-read-only (escrow-exists (escrow-id uint))
  (is-some (map-get? escrows escrow-id))
)

;; ============================================
;; private functions
;;
