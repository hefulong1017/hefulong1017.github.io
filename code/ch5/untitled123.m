for ii=1:4
    x1 = 0; x2 = 1; y1 = 0; y2 = 1; t1 = 0; t2 = 1; 
    s1 = 0.2;
    s2=0.1;
    m1 = (4 * 2^(ii-1));
    m2 = m1;
    N = 200;
    h1 = (x2 - x1) / m1; 
    h2 = h1;
    dt = (t2 - t1) / N;
    x = x1:h1:x2; x = x';
    y = y1:h2:y2; y = y';
    t = -s1:dt:t2; t = t';
    n1 = s1 / dt;
    n2=s2/dt;
    G = @(x, y, t)-(sqrt(2))/(1 + (2*x + 2*y - sqrt(2)/4*t)^2) + ...
    (32*(8*x + 8*y - sqrt(2)/4*t))/([1 + (2*x + 2*y - sqrt(2)/4*t)^2]^2) - ...
    (4*atan(2*x + 2*y - sqrt(2)/4*(t - 0.2)))/((1 + 16*atan(2*x + 2*y - sqrt(2)/4*(t - 0.1))^2)) - ...
    16*atan(2*x + 2*y - sqrt(2)/4*t)^2;
    u = zeros(m1+1, m2+1, N+n1+1);
    for i = 1:m1+1
        for k=n1+1:n1+N+1
            u(i, 1, k) =4*atan(2*x(i)-sqrt(2)/4*t(k));
            u(i, m2+1,k) =4*atan(2*x(i)+2-sqrt(2)/4*t(k));
        end
    end
    for j = 1:m2+1
        for k=n1+1:n1+N+1
            u(1, j, k) =4*atan(2*y(j)-sqrt(2)/4*t(k));
            u(m1+1, j,k) =4*atan(2*y(j)-sqrt(2)/4*t(k));
        end
    end
    for i = 1:m1+1
        for j = 1:m2+1
            for k = 1:n1+1
                u(i, j, k) =4*atan(2*x(i)+2*y(j)-sqrt(2)/4*t(k));
            end
        end
    end
    a = 2;
    r1 = a * dt / (h1^2);
    r2 = a * dt / (h2^2);
    I = speye(m1-1, m1-1);
    D = -r2 * I;
    row2 = zeros(m1-1, 1);
    row2(1, 1) = 11/6 -2 * (r1 + r2);
    row2(2, 1) = -r1;
    C = toeplitz(row2);
    A = kron(diag(ones(1, m2-2), 1) + diag(ones(1, m2-2), -1), D) + kron(diag(ones(1, m2-1)), C);

    for k = n1+1:N+n1+1
        H = zeros(m1-1, m2-1);  
        for i=2:m1-2
        for j = 2:m2
            H(i, j-1) = 3*u(i+1, j, k-1) -3/2 * u(i+1, j, k-2) + 1/3 * u(i+1, j, k-3) + ...
                dt * (G(x(i+1), y(j), t(k)) +(3 * u(i+1, j, k-1) - 3 * u(i+1, j, k-2) + u(i+1, j, k-3))^2 +(u(i+1,j, k-n1)/(1+(u(i+1,j, k-n2))^2)));
              H(1, j-1) = 3 * u(2, j, k-1) - 3/2 * u(2, j, k-2) + 1/3 * u(2, j, k-3) + r1*u(1,j,k)+...
                        dt * (G(x(2), y(j), t(k)) +(3 * u(2, j, k-1) - 3 * u(2, j, k-2) + u(2, j, k-3))^2 +(u(2,j, k-n1)/(1+(u(2,j, k-n2))^2)));
               H(m1-1, j-1) = 3 * u(m1, j, k-1) - 3/2 * u(m1, j, k-2) + 1/3 * u(m1, j, k-3) + r1*u(m1+1,j,k)+...
                        dt * (G(x(m1), y(j), t(k))+(3 * u(m1, j, k-1) - 3 * u(m1, j, k-2) + u(m1, j, k-3))^2 +(u(m1,j, k-n1)/(1+(u(m1,j, k-n2))^2)));
        end
        end
        H(:, 1) = H(:, 1) - D * u(2:m1, 1, k);
        H(:, m2-1) = H(:, m2-1) - D * u(2:m1, m2+1, k);  
        F = reshape(H, (m1-1) * (m2-1), 1);
        U1 =A\F;
        U2=reshape(U1, m1-1, m2-1);
        u(2:m1, 2:m2, k) = U2;
    end
    F = zeros(m1+1, m2+1, N+n1+1);
    for i = 1:m1+1
        for j = 1:m2+1
            for k = 1:N+n1+1
                F(i, j, k) = 4*atan(2*x(i)+2*y(j)-sqrt(2)/4*t(k));
            end
        end
    end

    error = abs(u - F);
    MaxErr(ii) = max(max(max(error)));
end

disp(MaxErr);
for i = 1:3
    ord(i) = MaxErr(i) / MaxErr(i+1);
end

disp(ord);