function [gcd_val, x_coeff, y_coeff] = extended_gcd(a, b)
    if b == 0
        gcd_val = a;
        x_coeff = 1;
        y_coeff = 0;
    else
        [gcd_val, temp_x, temp_y] = extended_gcd(b, mod(a, b));
        x_coeff = temp_y;
        y_coeff = temp_x - floor(a / b) * temp_y;
    end
end