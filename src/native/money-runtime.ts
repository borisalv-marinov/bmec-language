export const nativeMoneyRuntime = String.raw`
static bmec_money bmec_money_make(bmec_text digits, bool negative) {
  size_t first = 0;
  while (first < digits.length && digits.data[first] == '0') ++first;
  if (first == digits.length) {
    static const unsigned char zero[] = "0";
    return (bmec_money){ { zero, 1 }, false };
  }
  digits.data += first;
  digits.length -= first;
  return (bmec_money){ digits, negative };
}
static int bmec_money_abs_compare(bmec_text left, bmec_text right) {
  if (left.length != right.length) return left.length < right.length ? -1 : 1;
  int order = left.length ? memcmp(left.data, right.data, left.length) : 0;
  return order < 0 ? -1 : order > 0 ? 1 : 0;
}
static bmec_text bmec_money_add_abs(bmec_text left, bmec_text right) {
  size_t length = left.length > right.length ? left.length : right.length;
  if (length == SIZE_MAX) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded");
  unsigned char *digits = (unsigned char *)bmec_arena_alloc(length + 1);
  size_t i = left.length, j = right.length, at = length + 1;
  unsigned carry = 0;
  while (at > 1) {
    unsigned a = i ? (unsigned)(left.data[--i] - '0') : 0;
    unsigned b = j ? (unsigned)(right.data[--j] - '0') : 0;
    unsigned sum = a + b + carry;
    digits[--at] = (unsigned char)('0' + sum % 10);
    carry = sum / 10;
  }
  if (carry) digits[0] = (unsigned char)('0' + carry);
  return (bmec_text){ digits + (carry ? 0 : 1), length + (carry ? 1 : 0) };
}
static bmec_text bmec_money_sub_abs(bmec_text left, bmec_text right) {
  unsigned char *digits = left.length ? (unsigned char *)bmec_arena_alloc(left.length) : NULL;
  size_t i = left.length, j = right.length;
  int borrow = 0;
  while (i) {
    --i;
    int a = (int)(left.data[i] - '0') - borrow;
    int b = j ? (int)(right.data[--j] - '0') : 0;
    if (a < b) { a += 10; borrow = 1; } else borrow = 0;
    digits[i] = (unsigned char)('0' + a - b);
  }
  size_t first = 0;
  while (first + 1 < left.length && digits[first] == '0') ++first;
  return (bmec_text){ digits ? digits + first : NULL, left.length - first };
}
static bmec_money bmec_money_add(bmec_money left, bmec_money right) {
  if (left.negative == right.negative)
    return bmec_money_make(bmec_money_add_abs(left.digits, right.digits), left.negative);
  int order = bmec_money_abs_compare(left.digits, right.digits);
  if (!order) return bmec_money_make((bmec_text){ NULL, 0 }, false);
  return order > 0
    ? bmec_money_make(bmec_money_sub_abs(left.digits, right.digits), left.negative)
    : bmec_money_make(bmec_money_sub_abs(right.digits, left.digits), right.negative);
}
static bmec_money bmec_money_negate(bmec_money value) {
  value.negative = value.digits.length && !(value.digits.length == 1 && value.digits.data[0] == '0') && !value.negative;
  return value;
}
static int bmec_money_compare(bmec_money left, bmec_money right) {
  if (left.negative != right.negative) return left.negative ? -1 : 1;
  int order = bmec_money_abs_compare(left.digits, right.digits);
  return left.negative ? -order : order;
}
static bmec_text bmec_money_integer_digits(int64_t value, bool *negative) {
  unsigned char buffer[20];
  size_t at = sizeof(buffer);
  *negative = value < 0;
  uint64_t magnitude = *negative ? (uint64_t)(-(value + 1)) + 1 : (uint64_t)value;
  do { buffer[--at] = (unsigned char)('0' + magnitude % 10); magnitude /= 10; } while (magnitude);
  size_t length = sizeof(buffer) - at;
  unsigned char *digits = (unsigned char *)bmec_arena_alloc(length);
  memcpy(digits, buffer + at, length);
  return (bmec_text){ digits, length };
}
static bmec_money bmec_money_multiply(bmec_text left, bmec_text right, bool negative) {
  if (left.length > SIZE_MAX - right.length) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded");
  size_t length = left.length + right.length;
  unsigned char *digits = (unsigned char *)bmec_arena_alloc(length);
  memset(digits, '0', length);
  for (size_t i = left.length; i > 0; --i) {
    unsigned carry = 0;
    for (size_t j = right.length; j > 0; --j) {
      size_t at = i + j - 1;
      unsigned value = (unsigned)(digits[at] - '0') + (unsigned)(left.data[i - 1] - '0') * (unsigned)(right.data[j - 1] - '0') + carry;
      digits[at] = (unsigned char)('0' + value % 10);
      carry = value / 10;
    }
    size_t at = i - 1;
    while (carry) {
      unsigned value = (unsigned)(digits[at] - '0') + carry;
      digits[at] = (unsigned char)('0' + value % 10);
      carry = value / 10;
      if (at) --at; else if (carry) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded");
    }
  }
  return bmec_money_make((bmec_text){ digits, length }, negative);
}
static bmec_money bmec_money_multiply_integer(bmec_money value, int64_t factor) {
  bool negative;
  bmec_text digits = bmec_money_integer_digits(factor, &negative);
  return bmec_money_multiply(value.digits, digits, value.negative != negative);
}
static void bmec_money_subtract_in_place(unsigned char *left, size_t *left_length, bmec_text right) {
  size_t i = *left_length, j = right.length;
  int borrow = 0;
  while (i) {
    --i;
    int a = (int)(left[i] - '0') - borrow;
    int b = j ? (int)(right.data[--j] - '0') : 0;
    if (a < b) { a += 10; borrow = 1; } else borrow = 0;
    left[i] = (unsigned char)('0' + a - b);
  }
  size_t first = 0;
  while (first + 1 < *left_length && left[first] == '0') ++first;
  if (first) { memmove(left, left + first, *left_length - first); *left_length -= first; }
}
static bmec_money bmec_money_divide_integer(bmec_money value, int64_t divisor) {
  if (!divisor) bmec_fail("PIPE-RUNTIME-003: Division by zero");
  bool divisor_negative;
  bmec_text denominator = bmec_money_integer_digits(divisor, &divisor_negative);
  if (denominator.length == SIZE_MAX) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded");
  unsigned char *quotient = value.digits.length ? (unsigned char *)bmec_arena_alloc(value.digits.length) : NULL;
  unsigned char *remainder = (unsigned char *)bmec_arena_alloc(denominator.length + 1);
  remainder[0] = '0';
  size_t remainder_length = 1;
  for (size_t i = 0; i < value.digits.length; ++i) {
    if (remainder_length == 1 && remainder[0] == '0') remainder[0] = value.digits.data[i];
    else remainder[remainder_length++] = value.digits.data[i];
    size_t first = 0;
    while (first + 1 < remainder_length && remainder[first] == '0') ++first;
    if (first) { memmove(remainder, remainder + first, remainder_length - first); remainder_length -= first; }
    unsigned digit = 0;
    while (bmec_money_abs_compare((bmec_text){ remainder, remainder_length }, denominator) >= 0) {
      bmec_money_subtract_in_place(remainder, &remainder_length, denominator);
      ++digit;
    }
    quotient[i] = (unsigned char)('0' + digit);
  }
  bmec_text quotient_text = { quotient, value.digits.length };
  bmec_text remainder_text = { remainder, remainder_length };
  bmec_text twice_remainder = bmec_money_add_abs(remainder_text, remainder_text);
  if (bmec_money_abs_compare(twice_remainder, denominator) >= 0)
    quotient_text = bmec_money_add_abs(quotient_text, (bmec_text){ (const unsigned char *)"1", 1 });
  return bmec_money_make(quotient_text, value.negative != divisor_negative);
}
`.trim().split(/\r?\n/);
