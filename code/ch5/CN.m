for ii=1:4
    x1 = 0; x2 = 1; y1 = 0; y2 = 1; t1 = 0; t2 = 1; 
    s = 0.1;
    m1 = (10* 2^(ii-1));
    m2 = m1;
    n = m1;
    h1 = (x2 - x1) / m1; 
    h2 = h1;
    dt = (t2 - t1) / n;
    x = x1:h1:x2; x = x';
    y = y1:h2:y2; y = y';
    t = t1:dt:t2; t = t';
    G = @(x, y, t)-3/2*exp((x+y)/2-t);
    u = zeros(m1+1, m2+1, n+1);
    for i = 1:m1+1
        for k=1:n+1
            u(i, 1, k) =exp(x(i)/2-t(k));
            u(i, m2+1,k) =exp((x(i)+1)/2-t(k));
        end
    end
    for j = 1:m1+1
        for k=1:n+1
            u(1, j, k) =exp(y(j)/2-t(k));
            u(m1+1, j,k)=exp((1+y(j))/2-t(k));
        end
    end
    for i = 1:m1+1
        for j = 1:m2+1
            
                u(i, j, 1) = exp((x(i)+y(j))/2);
            end
        end
   
    a = 1;
    r1 = a * dt / (h1^2);
    r2 = a * dt / (h2^2);
    I = speye(m1-1, m1-1);
    D = -r2/2 * I;
    row2 = zeros(m1-1, 1);
    row2(1, 1) =1 +(r1 + r2);
    row2(2, 1) = -r1/2;
    C = toeplitz(row2);
    A = kron(diag(ones(1, m2-2), 1) + diag(ones(1, m2-2), -1), D) + kron(diag(ones(1, m2-1)), C);

    for k = 1:n
        t_khalf=(t(k)+t(k+1))/2;
        H = zeros(m1-1, m2-1);  
        for i=2:m1-2
        for j = 2:m2
            H(i, j-1) = r1/2*u(i,j,k)+(1-r1-r2)*u(i+1,j,k)+r1/2*u(i+2,j,k)+r2/2*u(i+1,j-1,k)+r2/2*u(i+1,j+1,k)+dt*G(x(i+1),y(j),t_khalf);
              H(1, j-1) =r1/2*u(1,j,k)+(1-r1-r2)*u(2,j,k)+r1/2*u(3,j,k)+r2/2*u(2,j-1,k)+r2/2*u(2,j+1,k)+dt*G(x(2),y(j),t_khalf)+r1/2*u(1,j,k+1);
               H(m1-1, j-1) = r1/2*u(m1-1,j,k)+(1-r1-r2)*u(m1,j,k)+r1/2*u(m1+1,j,k)+r2/2*u(m1,j-1,k)+r2/2*u(m1,j+1,k)+dt*G(x(m1),y(j),t_khalf)+r1/2*u(m1+1,j,k+1);
        end
        end
      
        H(:, 1) = H(:, 1) - D * u(2:m1, 1, k+1);
        H(:, m2-1) = H(:, m2-1) - D * u(2:m1, m2+1, k+1);  

        F = reshape(H, (m1-1) * (m2-1), 1);

        U1 =A\F;
U2=reshape(U1, m1-1, m2-1);
        u(2:m1, 2:m2, k+1) = U2;
    end
    F = zeros(m1+1, m2+1, n+1);
    for i = 1:m1+1
        for j = 1:m2+1
            for k = 1:n+1
                F(i, j, k) = exp((x(i)+y(j))/2-t(k));
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