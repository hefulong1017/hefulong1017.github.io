xa = 0; xb = 2;
ya = 0; yb = 1;
m = 64;
n = 64;
h1 = (xb - xa) / m;
h2 = (yb - ya) / n;
x = xa:h1:xb; x = x';
y = ya:h2:yb; y = y';
u = zeros(m+1, n+1);
u(1, :) = sin(pi * y);
u(m+1, :) = exp(2) * sin(pi * y);
u(:, 1) = 0;
u(:, n+1) = 0;
F = zeros(m+1, n+1);
for k = 1:m+1
    for j = 1:n+1
        F(k, j) = exp(x(k)) * sin(pi * y(j));
    end
end
restart = true;
total_iterations = 0;

while restart
    total_iterations = total_iterations + 1;  
    restart = false;
    
    for kk = 1 
        for i = 2:m
            for j = 2:n
                u(i, j) = (F2(x(i), y(j)) + (1/h2^2) * u(i, j-1) + (1/h1^2) * u(i-1, j)) / (2 * (1/h1^2 + 1/h2^2));
            end
        end
        u=F;
    end
 for kk = 2:1000 
      for i = 2:m
            for j = 2:n
                u(i, j) = (F2(x(i), y(j)) + (1/h2^2) * u(i, j-1) + (1/h1^2) * u(i-1, j) + (1/h1^2) * F(i+1, j) + (1/h2^2) * F(i, j+1)) / (2 * (1/h1^2 + 1/h2^2));
            end
        end
        
     
        if max(max(abs(u - F))) <= 5e-11
            break;  
        else
           
            if max(max(abs(u - F))) > 5e-11
                 F = u; 
                restart = true; 
            end
        end
    end
end
disp(['总循环次数: ', num2str(total_iterations)]); 
disp(['最终的最大绝对差值: ', num2str(max(max(abs(u - F))))]); 